"""Phase 10 · 练习工坊：把用户的自然语言描述用 LLM 变成可运行的"练习规格"。

设计（hybrid）:
- 默认 structured 模式：AI 只输出一份 JSON spec，由前端用内置练习块渲染，安全稳定可复用。
- 当需求超出内置块（需要高度自定义的交互/模拟）时，降级为 sandbox 模式：
  AI 输出一段自包含 HTML，前端放进隔离 iframe（禁网络）运行。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import HTTPException
from openai import APIError as OpenAIAPIError

from ..core.llm import ModelTier, build_chat_kwargs, get_client, resolve_model
from ..db import repos
from ..schemas.practice_studio import GeneratePracticeStudioRequest

logger = logging.getLogger(__name__)

# 可嵌入的现有训练组件（需与前端 web/lib/widgets/registry.tsx 保持一致）
ALLOWED_WIDGETS = {
    "poker.table",
    "poker.equity",
    "poker.range",
    "japanese.kana",
    "japanese.flashcards",
    "quant.backtest",
    "quant.kelly",
    "commerce.funnel",
    "commerce.script",
    "chinese.dictation",
    "chinese.essay",
    "math.grapher",
    "math.drill",
    "english.vocab",
    "english.verbs",
}

_MAX_BLOCKS = 14
_MAX_SANDBOX_CHARS = 60_000

_SYSTEM_PROMPT = """你是「练习设计专家」。用户会用自然语言描述想练什么，你要产出一份**可直接运行的练习规格 JSON**，重在“动手练 + 即时反馈”，而不是长篇讲解。

只输出 JSON，不要 markdown 代码块，不要多余文字。

顶层结构：
{
  "title": "简短标题",
  "domain": "所属领域，如 数学/英语/日语/编程/德州扑克/通用",
  "description": "一句话说明这套练习练什么",
  "mode": "structured" 或 "sandbox",
  "blocks": [ ... ],          // mode=structured 时必填
  "sandbox_html": "..."       // mode=sandbox 时必填
}

优先用 structured 模式。blocks 是练习块数组（3~12 个为宜），每个块是下列之一：

1. 单选题
   {"type":"mcq","prompt":"题干(可含 $LaTeX$)","options":["A","B","C","D"],"answer":0,"explanation":"讲解"}
2. 多选题
   {"type":"multi","prompt":"...","options":[...],"answers":[0,2],"explanation":"..."}
3. 填空题（prompt 里用 ___ 表示空位，blanks 按顺序给答案）
   {"type":"fill_blank","prompt":"中国的首都是 ___","blanks":[{"answer":"北京","accept":["Beijing"]}],"explanation":"..."}
4. 闪卡（记忆/背诵）
   {"type":"flashcard","cards":[{"front":"正面","back":"背面"}]}
5. 配对
   {"type":"match","pairs":[{"left":"apple","right":"苹果"}]}
6. 排序（items 按**正确顺序**给出，前端会打乱让用户排）
   {"type":"order","prompt":"把步骤排序","items":["第一步","第二步","第三步"],"explanation":"..."}
7. 简答（开放题，给参考答案与关键词用于自评/判分）
   {"type":"short_answer","prompt":"...","reference":"参考答案","keywords":["要点1","要点2"]}
8. 说明/引导（不计分）
   {"type":"info","title":"可选","markdown":"讲解或提示，可含 $LaTeX$"}
9. 嵌入现有训练组件（不计分，仅在与主题强相关时使用）
   {"type":"widget","widget":"<下列之一>","note":"可选说明"}
   可用 widget：poker.table, poker.equity, poker.range, japanese.kana, japanese.flashcards,
   quant.backtest, quant.kelly, commerce.funnel, commerce.script, chinese.dictation,
   chinese.essay, math.grapher, math.drill, english.vocab, english.verbs

规则：
- 尽量以“做题/操作”为主，控制讲解块比例；每套练习尽量含即时判分的块（mcq/multi/fill_blank/order/match）。
- 数学公式用 $...$ 或 $$...$$。答案下标从 0 开始。
- 内容要具体、可判分，不要含糊。难度、题量参考用户要求。
- 只有当用户明确需要内置块无法表达的自定义交互（如可拖拽模拟器、自定义小游戏、可视化实验）时，才用 sandbox 模式。
  sandbox_html 要求：一段**自包含**的 HTML 片段（可含 <style> 和 <script>，纯内联），
  不得引用任何外部资源/CDN/网络请求，不要写 <html>/<head>/<body> 外壳；要能在移动端正常显示，深浅色皆可读。

输出中文。"""


def _load_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    fence = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, flags=re.S | re.I)
    if fence:
        text = fence.group(1)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("练习规格必须是 JSON 对象")
    return value


def _s(value: Any, limit: int = 2000) -> str:
    return str(value if value is not None else "")[:limit]


def _str_list(value: Any, *, limit: int, item_limit: int = 400) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:limit]:
        text = _s(item, item_limit).strip()
        if text:
            out.append(text)
    return out


def _clean_block(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    btype = str(raw.get("type") or "").strip()

    if btype == "info":
        md = _s(raw.get("markdown"), 4000).strip()
        if not md:
            return None
        block: dict[str, Any] = {"type": "info", "markdown": md}
        title = _s(raw.get("title"), 120).strip()
        if title:
            block["title"] = title
        return block

    if btype == "mcq":
        options = _str_list(raw.get("options"), limit=6)
        if len(options) < 2:
            return None
        try:
            answer = int(raw.get("answer"))
        except (TypeError, ValueError):
            return None
        if not (0 <= answer < len(options)):
            return None
        return {
            "type": "mcq",
            "prompt": _s(raw.get("prompt"), 1200),
            "options": options,
            "answer": answer,
            "explanation": _s(raw.get("explanation"), 1200),
        }

    if btype == "multi":
        options = _str_list(raw.get("options"), limit=6)
        if len(options) < 2:
            return None
        answers_raw = raw.get("answers")
        answers: list[int] = []
        if isinstance(answers_raw, list):
            for a in answers_raw:
                try:
                    ai = int(a)
                except (TypeError, ValueError):
                    continue
                if 0 <= ai < len(options) and ai not in answers:
                    answers.append(ai)
        if not answers:
            return None
        return {
            "type": "multi",
            "prompt": _s(raw.get("prompt"), 1200),
            "options": options,
            "answers": sorted(answers),
            "explanation": _s(raw.get("explanation"), 1200),
        }

    if btype == "fill_blank":
        raw_blanks = raw.get("blanks")
        blanks: list[dict[str, Any]] = []
        if isinstance(raw_blanks, list):
            for b in raw_blanks[:8]:
                if not isinstance(b, dict):
                    continue
                ans = _s(b.get("answer"), 200).strip()
                if not ans:
                    continue
                blanks.append(
                    {
                        "answer": ans,
                        "accept": _str_list(b.get("accept"), limit=6, item_limit=200),
                    }
                )
        if not blanks:
            return None
        return {
            "type": "fill_blank",
            "prompt": _s(raw.get("prompt"), 1200),
            "blanks": blanks,
            "explanation": _s(raw.get("explanation"), 1200),
        }

    if btype == "flashcard":
        raw_cards = raw.get("cards")
        cards: list[dict[str, str]] = []
        if isinstance(raw_cards, list):
            for c in raw_cards[:30]:
                if not isinstance(c, dict):
                    continue
                front = _s(c.get("front"), 400).strip()
                back = _s(c.get("back"), 800).strip()
                if front and back:
                    cards.append({"front": front, "back": back})
        if not cards:
            return None
        return {"type": "flashcard", "cards": cards}

    if btype == "match":
        raw_pairs = raw.get("pairs")
        pairs: list[dict[str, str]] = []
        if isinstance(raw_pairs, list):
            for p in raw_pairs[:10]:
                if not isinstance(p, dict):
                    continue
                left = _s(p.get("left"), 200).strip()
                right = _s(p.get("right"), 200).strip()
                if left and right:
                    pairs.append({"left": left, "right": right})
        if len(pairs) < 2:
            return None
        return {"type": "match", "pairs": pairs}

    if btype == "order":
        items = _str_list(raw.get("items"), limit=8)
        if len(items) < 2:
            return None
        block = {"type": "order", "items": items, "explanation": _s(raw.get("explanation"), 1200)}
        prompt = _s(raw.get("prompt"), 800).strip()
        if prompt:
            block["prompt"] = prompt
        return block

    if btype == "short_answer":
        prompt = _s(raw.get("prompt"), 1200).strip()
        if not prompt:
            return None
        return {
            "type": "short_answer",
            "prompt": prompt,
            "reference": _s(raw.get("reference"), 2000),
            "keywords": _str_list(raw.get("keywords"), limit=10, item_limit=80),
        }

    if btype == "widget":
        widget = str(raw.get("widget") or "").strip()
        if widget not in ALLOWED_WIDGETS:
            return None
        return {"type": "widget", "widget": widget, "note": _s(raw.get("note"), 300)}

    return None


def _normalize_spec(raw: dict[str, Any]) -> dict[str, Any]:
    title = _s(raw.get("title"), 200).strip() or "定制练习"
    domain = _s(raw.get("domain"), 60).strip() or "通用"
    description = _s(raw.get("description"), 500).strip()
    mode = str(raw.get("mode") or "structured").strip()

    if mode == "sandbox":
        html = _s(raw.get("sandbox_html"), _MAX_SANDBOX_CHARS)
        if not html.strip():
            raise ValueError("sandbox 模式缺少 sandbox_html")
        return {
            "title": title,
            "domain": domain,
            "description": description,
            "mode": "sandbox",
            "sandbox_html": html,
        }

    raw_blocks = raw.get("blocks")
    if not isinstance(raw_blocks, list):
        raise ValueError("structured 模式缺少 blocks 数组")
    blocks: list[dict[str, Any]] = []
    for rb in raw_blocks[:_MAX_BLOCKS]:
        cleaned = _clean_block(rb)
        if cleaned:
            blocks.append(cleaned)
    if not blocks:
        raise ValueError("没有生成有效的练习块")

    return {
        "title": title,
        "domain": domain,
        "description": description,
        "mode": "structured",
        "blocks": blocks,
    }


async def generate(
    *, owner_id: str, payload: GeneratePracticeStudioRequest
) -> dict[str, Any]:
    model = resolve_model(ModelTier.MEDIUM)
    parts = [f"练习需求：{payload.description}"]
    if payload.domain:
        parts.append(f"领域：{payload.domain}")
    if payload.difficulty:
        parts.append(f"难度：{payload.difficulty}")
    if payload.count:
        parts.append(f"期望题量：约 {payload.count} 题")
    user_prompt = "\n".join(parts)

    try:
        resp = await get_client().chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.6,
                response_format={"type": "json_object"},
                max_tokens=6000,
            )
        )
    except OpenAIAPIError as exc:
        logger.warning("practice studio generate llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"练习生成失败: {exc}") from exc

    text = resp.choices[0].message.content or ""
    try:
        spec = _normalize_spec(_load_json(text))
    except Exception as exc:  # noqa: BLE001
        logger.warning("practice studio bad spec: %s\n%s", exc, text[:600])
        raise HTTPException(status_code=502, detail="练习结构异常，请调整描述后重试") from exc

    row = repos.create_practice_spec(
        owner_id,
        {
            "title": spec["title"],
            "domain": spec["domain"],
            "description": spec["description"],
            "prompt": payload.description,
            "mode": spec["mode"],
            "spec": spec,
            "generated_by_model": model,
        },
    )
    return row
