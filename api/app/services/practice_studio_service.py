"""Phase 10 · 练习工坊：把用户描述用 LLM 变成可运行的「交互式训练器」。

工坊 ≠ 练习。练习是做题(问答判分)；工坊产出的是一个可反复操作的交互式训练器
(像一个独立的小应用/模拟器/沙盘)，用户在里面动手调参、模拟、练动作、看实时反馈。

hybrid 生成:
- 优先 template: 把需求映射到内置训练器模板 + 配置(JSON)。稳、快、精致。
  6 类模板: simulator / timed_drill / audio_trainer / flashcards_srs / drag_order / decision_tree
- 兜底 app: 模板覆盖不到时, AI 现场写一个自包含交互式微应用(HTML+JS)，
  跑在隔离 iframe(禁网络, 可用 Canvas/WebAudio/SpeechSynthesis)。
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
from ..schemas.practice_studio import (
    GeneratePracticeStudioRequest,
    PlanPracticeStudioRequest,
    RefinePracticeStudioRequest,
)

logger = logging.getLogger(__name__)

TEMPLATE_IDS = {
    "simulator",
    "timed_drill",
    "audio_trainer",
    "flashcards_srs",
    "drag_order",
    "decision_tree",
}

TEMPLATE_LABELS = {
    "simulator": "参数模拟器",
    "timed_drill": "计时反应训练",
    "audio_trainer": "音频/跟读",
    "flashcards_srs": "记忆卡 (SRS)",
    "drag_order": "拖拽构造",
    "decision_tree": "决策沙盘",
}

_MAX_APP_CHARS = 60_000

# medium 档是 reasoning 模型(gpt-5.4)，max_tokens 会映射成 max_completion_tokens，
# 推理 token 先吃预算，剩下才是可见输出。预算给太小会把 JSON/HTML 从中间截断。
_PLAN_MAX_TOKENS = 6_000  # 规划 JSON 很短，但要给推理留足余量
_GENERATE_MAX_TOKENS = 12_000  # app 模式会吐大段 HTML，需要更大空间

# 显式覆盖 OpenAI SDK 默认超时(600s)，让后端比前端稍早失败并给出干净错误。
_PLAN_REQUEST_TIMEOUT = 75.0
_GENERATE_REQUEST_TIMEOUT = 190.0

_SYSTEM_PROMPT = """你是「交互式训练器」设计师。用户描述想练什么，你要为他造一台**可反复操作的交互式训练器**——像一个独立的小应用/模拟器/沙盘，能动手调参、模拟、练动作、即时看反馈。

严禁产出"题目/选择题/填空题"式的答题卷（那是另一个功能）。这里要的是"器械"，不是"试卷"。

只输出 JSON，不要 markdown、不要多余文字。

顶层：
{
  "kind": "template" 或 "app",
  "title": "简短标题",
  "domain": "领域，如 量化/物理/日语/音乐/编程/德州扑克/通用",
  "description": "一句话说明这台训练器练什么",
  "goal": "用它要达成的训练目标",
  "template_id": "...",   // kind=template 时必填
  "config": { ... },      // kind=template 时必填
  "html": "..."           // kind=app 时必填
}

优先用 template。可选的 6 个模板：

1) simulator（参数模拟器：调滑块→实时看数值/曲线）——适合 量化回测/凯利、复利贷款、抛体/电路/单摆、函数图像与导数、概率分布、扑克赔率等。
config: {
  "params":[{"id":"英文短标识","label":"名称","min":0,"max":100,"step":1,"default":10,"unit":"可选单位"}],
  "outputs":[{"label":"输出名","expr":"关于param的表达式","unit":"可选","precision":2}],
  "chart":{"xId":"x","xLabel":"x轴名","xMin":0,"xMax":10,"series":[{"label":"曲线名","expr":"关于param和x的表达式"}]}  // 可选
}
表达式支持 + - * / ^ 和括号，函数 sin cos tan asin acos atan sqrt abs exp ln log log10 pow min max floor ceil round，常量 pi e。变量只能用 param 的 id（chart 里额外可用 xId）。至少要有 outputs 或 chart。

2) timed_drill（计时反应训练器：限时快答，练熟练度，记连击/最佳）——口算、假名闪认、元素符号、听辨、打字等。
config: {"durationSec":60,"mode":"choice"或"text","items":[{"prompt":"题面","answer":"标准答案","options":["A","B","C","D"],"accept":["可接受的别写"]}]}
choice 用 options（含正确答案）；text 用 answer(+accept)。给 15~40 个 item。

3) audio_trainer（音频训练器，用浏览器 TTS/节拍，无需联网）
shadow(影子跟读): {"mode":"shadow","lang":"如 ja-JP / en-US / zh-CN","items":[{"text":"要跟读的句子","translation":"可选中文"}]}
metronome(节拍器): {"mode":"metronome","bpmDefault":80,"bpmMin":40,"bpmMax":200}

4) flashcards_srs（间隔重复记忆卡）——单词/公式/年表等。
config: {"cards":[{"front":"正面","back":"背面"}]}  // 8~40 张

5) drag_order（拖拽构造器）
order(排序): {"mode":"order","prompt":"提示","items":["按正确顺序给出"],"explanation":"可选"}
categorize(归类): {"mode":"categorize","prompt":"提示","buckets":[{"id":"a","label":"类别A"}],"cards":[{"text":"条目","bucket":"a"}],"explanation":"可选"}

6) decision_tree（策略决策沙盘：给情境→选择→看后果/是否最优，可多步）——扑克范围决策、带货/谈判话术树、急救流程等。
config: {"start":"n1","nodes":{"n1":{"situation":"情境描述","options":[{"label":"选项","feedback":"选后反馈","optimal":true,"next":"n2"}]}}}

当以上都不合适（需要高度自定义的交互/可视化/小游戏）时，用 kind="app"：
html 是一段**自包含**的 HTML 片段（可含 <style> 和 <script>，纯内联），不要写 <html>/<head>/<body> 外壳；
禁止任何外部资源/CDN/网络请求；可以用 Canvas、Web Audio、SpeechSynthesis、requestAnimationFrame；要在移动端可用、浅色背景可读；本身就是一台能动手练的训练器（有控制、有反馈、有目标）。

【先出可用首版，控制规模以加快生成】即使需求写了更大的数量，首版也请克制，保证能立刻用起来（用户之后可用「改一改」继续扩充）：timed_drill 12~20 题、flashcards 10~20 张、drag_order categorize ≤ 3 桶且 ≤ 12 条、decision_tree ≤ 8 个节点、audio(shadow) 8~15 句、simulator ≤ 5 个参数。app 模式的 HTML 也要精简聚焦，避免冗长。

所有文本用中文（跟读句子按目标语言）。"""


_PLAN_SYSTEM_PROMPT = """你是「交互式训练器」的规划师。用户给一段需求描述，你要**先规划**出最合适的训练器形态与配置蓝图，供用户确认/微调后再真正生成（这一步不产出最终内容，不要写题目/卡片/HTML）。

只输出 JSON，不要 markdown、不要多余文字：
{
  "title": "简短标题",
  "domain": "领域，如 量化/物理/日语/音乐/编程/德州扑克/通用",
  "difficulty": "难度，如 入门/进阶/N5/高考 等",
  "kind": "template" 或 "app",
  "template_id": "kind=template 时必填，下列之一",
  "goal": "用它要达成的训练目标(一句话)",
  "outline": ["3~6 条要点，说明这台训练器会包含什么、怎么练"],
  "generation_prompt": "一段给『生成器』的详细中文指令，具体说明要做成什么样：交互方式、关键参数/题目/卡片/节点、数量、难度、判分或反馈方式等，尽量具体、可直接执行"
}

优先用 template（能覆盖就别用 app）。可选 template：
- simulator 参数模拟器：调滑块→实时看数值/曲线（复利/凯利、抛体/电路、函数图像、概率、扑克赔率…）
- timed_drill 计时反应训练：限时快答练熟练度（口算、假名闪认、元素符号、听辨、打字…）
- audio_trainer 音频/跟读：浏览器 TTS 跟读 或 节拍器（语言影子跟读、视唱练耳…）
- flashcards_srs 记忆卡：间隔重复记忆（单词/公式/年表…）
- drag_order 拖拽构造：排序 或 归类（步骤排序、词性归类、语序…）
- decision_tree 决策沙盘：情境→选择→看后果/最优（扑克范围、话术树、急救流程…）
只有当内置模板都无法表达（需要高度自定义的可视化/模拟/小游戏）时，kind 用 "app"，template_id 置空。

generation_prompt 会被下一步直接使用，务必写清楚、可执行。数量要克制（首版可用即可，别一次要几十道题/十几个节点，用户之后能继续扩充）。全部中文输出。"""


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
        raise ValueError("训练器规格必须是 JSON 对象")
    return value


def _s(value: Any, limit: int = 2000) -> str:
    return str(value if value is not None else "")[:limit]


def _slug(raw: Any, fallback: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw or "")).strip("_")
    return value[:32] or fallback


def _num(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n != n:  # NaN
        return default
    return max(lo, min(hi, n))


def _int(value: Any, default: int, lo: int, hi: int) -> int:
    return int(_num(value, default, lo, hi))


def _str_list(value: Any, *, limit: int, item_limit: int = 400) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:limit]:
        text = _s(item, item_limit).strip()
        if text:
            out.append(text)
    return out


# -----------------------------------------------------------------------------
# 各模板配置校验
# -----------------------------------------------------------------------------
def _clean_simulator(cfg: dict) -> dict:
    raw_params = cfg.get("params")
    params: list[dict] = []
    if isinstance(raw_params, list):
        for i, p in enumerate(raw_params[:10]):
            if not isinstance(p, dict):
                continue
            pid = _slug(p.get("id"), f"p{i + 1}")
            lo = _num(p.get("min"), 0, -1e9, 1e9)
            hi = _num(p.get("max"), lo + 1, -1e9, 1e9)
            if hi <= lo:
                hi = lo + 1
            params.append(
                {
                    "id": pid,
                    "label": _s(p.get("label"), 40) or pid,
                    "min": lo,
                    "max": hi,
                    "step": _num(p.get("step"), (hi - lo) / 100 or 1, 1e-6, 1e9),
                    "default": _num(p.get("default"), (lo + hi) / 2, lo, hi),
                    "unit": _s(p.get("unit"), 12),
                }
            )
    if not params:
        raise ValueError("simulator 缺少 params")

    outputs: list[dict] = []
    for o in (cfg.get("outputs") or [])[:8]:
        if not isinstance(o, dict):
            continue
        expr = _s(o.get("expr"), 400).strip()
        if not expr:
            continue
        outputs.append(
            {
                "label": _s(o.get("label"), 40) or "结果",
                "expr": expr,
                "unit": _s(o.get("unit"), 12),
                "precision": _int(o.get("precision"), 2, 0, 6),
            }
        )

    chart = None
    raw_chart = cfg.get("chart")
    if isinstance(raw_chart, dict):
        series = []
        for s in (raw_chart.get("series") or [])[:5]:
            if not isinstance(s, dict):
                continue
            expr = _s(s.get("expr"), 400).strip()
            if not expr:
                continue
            series.append({"label": _s(s.get("label"), 40) or "曲线", "expr": expr})
        if series:
            x_lo = _num(raw_chart.get("xMin"), 0, -1e9, 1e9)
            x_hi = _num(raw_chart.get("xMax"), x_lo + 10, -1e9, 1e9)
            if x_hi <= x_lo:
                x_hi = x_lo + 10
            chart = {
                "xId": _slug(raw_chart.get("xId"), "x"),
                "xLabel": _s(raw_chart.get("xLabel"), 30) or "x",
                "xMin": x_lo,
                "xMax": x_hi,
                "series": series,
            }

    if not outputs and not chart:
        raise ValueError("simulator 至少要有 outputs 或 chart")
    result: dict[str, Any] = {"params": params, "outputs": outputs}
    if chart:
        result["chart"] = chart
    return result


def _clean_timed_drill(cfg: dict) -> dict:
    mode = "choice" if cfg.get("mode") == "choice" else (
        "text" if cfg.get("mode") == "text" else "choice"
    )
    items: list[dict] = []
    for it in (cfg.get("items") or [])[:60]:
        if not isinstance(it, dict):
            continue
        prompt = _s(it.get("prompt"), 300).strip()
        answer = _s(it.get("answer"), 200).strip()
        if not prompt or not answer:
            continue
        entry: dict[str, Any] = {"prompt": prompt, "answer": answer}
        if mode == "choice":
            opts = _str_list(it.get("options"), limit=6, item_limit=200)
            if answer not in opts:
                opts = ([answer] + opts)[:6]
            if len(opts) < 2:
                continue
            entry["options"] = opts
        else:
            entry["accept"] = _str_list(it.get("accept"), limit=6, item_limit=200)
        items.append(entry)
    if len(items) < 3:
        raise ValueError("timed_drill 至少需要 3 个 item")
    return {
        "durationSec": _int(cfg.get("durationSec"), 60, 20, 600),
        "mode": mode,
        "items": items,
    }


def _clean_audio(cfg: dict) -> dict:
    mode = "metronome" if cfg.get("mode") == "metronome" else "shadow"
    if mode == "metronome":
        lo = _int(cfg.get("bpmMin"), 40, 20, 400)
        hi = _int(cfg.get("bpmMax"), 200, lo + 1, 400)
        return {
            "mode": "metronome",
            "bpmDefault": _int(cfg.get("bpmDefault"), 80, lo, hi),
            "bpmMin": lo,
            "bpmMax": hi,
        }
    items: list[dict] = []
    for it in (cfg.get("items") or [])[:40]:
        if not isinstance(it, dict):
            continue
        text = _s(it.get("text"), 300).strip()
        if not text:
            continue
        items.append(
            {"text": text, "translation": _s(it.get("translation"), 300).strip()}
        )
    if not items:
        raise ValueError("audio_trainer(shadow) 需要 items")
    return {"mode": "shadow", "lang": _s(cfg.get("lang"), 12) or "en-US", "items": items}


def _clean_flashcards(cfg: dict) -> dict:
    cards: list[dict] = []
    for c in (cfg.get("cards") or [])[:60]:
        if not isinstance(c, dict):
            continue
        front = _s(c.get("front"), 400).strip()
        back = _s(c.get("back"), 800).strip()
        if front and back:
            cards.append({"front": front, "back": back})
    if not cards:
        raise ValueError("flashcards_srs 需要 cards")
    return {"cards": cards}


def _clean_drag_order(cfg: dict) -> dict:
    mode = "categorize" if cfg.get("mode") == "categorize" else "order"
    prompt = _s(cfg.get("prompt"), 500).strip()
    explanation = _s(cfg.get("explanation"), 1000).strip()
    if mode == "order":
        items = _str_list(cfg.get("items"), limit=10)
        if len(items) < 2:
            raise ValueError("drag_order(order) 需要 >=2 个 items")
        return {"mode": "order", "prompt": prompt, "items": items, "explanation": explanation}
    buckets = []
    for b in (cfg.get("buckets") or [])[:6]:
        if not isinstance(b, dict):
            continue
        bid = _slug(b.get("id"), f"b{len(buckets) + 1}")
        buckets.append({"id": bid, "label": _s(b.get("label"), 40) or bid})
    bucket_ids = {b["id"] for b in buckets}
    cards = []
    for c in (cfg.get("cards") or [])[:24]:
        if not isinstance(c, dict):
            continue
        text = _s(c.get("text"), 200).strip()
        bucket = _slug(c.get("bucket"), "")
        if text and bucket in bucket_ids:
            cards.append({"text": text, "bucket": bucket})
    if len(buckets) < 2 or len(cards) < 2:
        raise ValueError("drag_order(categorize) 需要 >=2 桶且 >=2 条目")
    return {
        "mode": "categorize",
        "prompt": prompt,
        "buckets": buckets,
        "cards": cards,
        "explanation": explanation,
    }


def _clean_decision_tree(cfg: dict) -> dict:
    raw_nodes = cfg.get("nodes")
    if not isinstance(raw_nodes, dict):
        raise ValueError("decision_tree 缺少 nodes")
    nodes: dict[str, Any] = {}
    for nid, node in list(raw_nodes.items())[:12]:
        if not isinstance(node, dict):
            continue
        situation = _s(node.get("situation"), 800).strip()
        options = []
        for o in (node.get("options") or [])[:5]:
            if not isinstance(o, dict):
                continue
            label = _s(o.get("label"), 200).strip()
            if not label:
                continue
            opt: dict[str, Any] = {
                "label": label,
                "feedback": _s(o.get("feedback"), 800).strip(),
                "optimal": bool(o.get("optimal")),
            }
            nxt = _s(o.get("next"), 40).strip()
            if nxt:
                opt["next"] = nxt
            options.append(opt)
        if situation and len(options) >= 2:
            nodes[str(nid)[:40]] = {"situation": situation, "options": options}
    if not nodes:
        raise ValueError("decision_tree 没有有效节点")
    start = _s(cfg.get("start"), 40).strip()
    if start not in nodes:
        start = next(iter(nodes.keys()))
    # 清理指向不存在节点的 next
    for node in nodes.values():
        for opt in node["options"]:
            if "next" in opt and opt["next"] not in nodes:
                opt.pop("next")
    return {"start": start, "nodes": nodes}


_TEMPLATE_CLEANERS = {
    "simulator": _clean_simulator,
    "timed_drill": _clean_timed_drill,
    "audio_trainer": _clean_audio,
    "flashcards_srs": _clean_flashcards,
    "drag_order": _clean_drag_order,
    "decision_tree": _clean_decision_tree,
}


def _normalize_trainer(raw: dict[str, Any]) -> dict[str, Any]:
    title = _s(raw.get("title"), 200).strip() or "定制训练器"
    domain = _s(raw.get("domain"), 60).strip() or "通用"
    description = _s(raw.get("description"), 500).strip()
    goal = _s(raw.get("goal"), 500).strip()
    kind = "app" if raw.get("kind") == "app" else "template"

    base: dict[str, Any] = {
        "title": title,
        "domain": domain,
        "description": description,
        "goal": goal,
    }

    if kind == "app":
        html = _s(raw.get("html") or raw.get("sandbox_html"), _MAX_APP_CHARS)
        if not html.strip():
            raise ValueError("app 模式缺少 html")
        base["kind"] = "app"
        base["html"] = html
        return base

    template_id = str(raw.get("template_id") or "").strip()
    if template_id not in TEMPLATE_IDS:
        raise ValueError(f"未知 template_id: {template_id}")
    cfg = raw.get("config")
    if not isinstance(cfg, dict):
        raise ValueError("template 缺少 config")
    base["kind"] = "template"
    base["template_id"] = template_id
    base["config"] = _TEMPLATE_CLEANERS[template_id](cfg)
    return base


def _normalize_plan(raw: dict[str, Any], *, fallback_desc: str) -> dict[str, Any]:
    kind = "app" if raw.get("kind") == "app" else "template"
    template_id = str(raw.get("template_id") or "").strip()
    if kind == "app":
        template_id = ""
    elif template_id not in TEMPLATE_IDS:
        # 规划师没给出合法模板 → 交给下一步的生成器自动决定形态
        template_id = ""

    outline = _str_list(raw.get("outline"), limit=6, item_limit=200)
    generation_prompt = _s(raw.get("generation_prompt"), 3000).strip() or fallback_desc

    if template_id:
        template_label: str | None = TEMPLATE_LABELS.get(template_id)
    elif kind == "app":
        template_label = "定制应用"
    else:
        template_label = None

    return {
        "title": _s(raw.get("title"), 200).strip() or "定制训练器",
        "domain": _s(raw.get("domain"), 60).strip() or "通用",
        "difficulty": _s(raw.get("difficulty"), 40).strip() or None,
        "kind": kind,
        "template_id": template_id or None,
        "template_label": template_label,
        "goal": _s(raw.get("goal"), 500).strip(),
        "outline": outline,
        "generation_prompt": generation_prompt,
    }


def _fallback_plan(description: str) -> dict[str, Any]:
    """LLM 规划解析失败时的兜底：形态交给下一步自动决定，指令沿用原描述。

    这样两步流程永远能往下走，用户可在第二步手动微调形态与生成指令。
    """
    return {
        "title": "定制训练器",
        "domain": "通用",
        "difficulty": None,
        "kind": "template",
        "template_id": None,
        "template_label": None,
        "goal": "",
        "outline": [],
        "generation_prompt": description.strip(),
    }


async def plan(*, payload: PlanPracticeStudioRequest) -> dict[str, Any]:
    """第一步：分析描述，产出训练器规划(形态+配置+可编辑的生成指令)。"""
    model = resolve_model(ModelTier.MEDIUM)
    parts = [f"训练需求：{payload.description}"]
    if payload.domain:
        parts.append(f"领域：{payload.domain}")
    if payload.difficulty:
        parts.append(f"难度：{payload.difficulty}")
    user_prompt = "\n".join(parts)

    try:
        resp = await get_client().with_options(
            timeout=_PLAN_REQUEST_TIMEOUT
        ).chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _PLAN_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5,
                response_format={"type": "json_object"},
                max_tokens=_PLAN_MAX_TOKENS,
            )
        )
    except OpenAIAPIError as exc:
        logger.warning("practice studio plan llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"规划失败: {exc}") from exc

    text = resp.choices[0].message.content or ""
    try:
        return _normalize_plan(_load_json(text), fallback_desc=payload.description)
    except Exception as exc:  # noqa: BLE001
        # 解析失败(如偶发截断)不硬失败：兜底给一份可继续编辑的规划
        logger.warning("practice studio bad plan, using fallback: %s\n%s", exc, text[:600])
        return _fallback_plan(payload.description)


async def generate(
    *, owner_id: str, payload: GeneratePracticeStudioRequest
) -> dict[str, Any]:
    model = resolve_model(ModelTier.MEDIUM)
    parts = [f"训练需求：{payload.description}"]
    if payload.domain:
        parts.append(f"领域：{payload.domain}")
    if payload.difficulty:
        parts.append(f"难度：{payload.difficulty}")
    if payload.count:
        parts.append(f"期望数量：约 {payload.count} 个")
    if payload.goal:
        parts.append(f"训练目标：{payload.goal}")

    # 用户在规划里确认/微调后可能强制指定形态
    forced = (payload.template_id or "").strip()
    if forced in TEMPLATE_IDS:
        parts.append(
            f'【强制形态】必须用 kind="template"，template_id 固定为 "{forced}"'
            f"（{TEMPLATE_LABELS.get(forced, forced)}），不要改用其它形态。"
        )
    elif forced == "app":
        parts.append('【强制形态】必须用 kind="app"（现场生成自包含交互式应用）。')

    user_prompt = "\n".join(parts)

    try:
        resp = await get_client().with_options(
            timeout=_GENERATE_REQUEST_TIMEOUT
        ).chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.55,
                response_format={"type": "json_object"},
                max_tokens=_GENERATE_MAX_TOKENS,
            )
        )
    except OpenAIAPIError as exc:
        logger.warning("practice studio generate llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"训练器生成失败: {exc}") from exc

    text = resp.choices[0].message.content or ""
    try:
        spec = _normalize_trainer(_load_json(text))
    except Exception as exc:  # noqa: BLE001
        logger.warning("practice studio bad spec: %s\n%s", exc, text[:600])
        raise HTTPException(
            status_code=502, detail="训练器结构异常，请调整描述后重试"
        ) from exc

    # 尊重用户在规划里确认/微调的元数据
    if payload.title and payload.title.strip():
        spec["title"] = payload.title.strip()[:200]
    if payload.domain and payload.domain.strip():
        spec["domain"] = payload.domain.strip()[:60]
    if payload.goal and payload.goal.strip():
        spec["goal"] = payload.goal.strip()[:500]

    row = repos.create_practice_spec(
        owner_id,
        {
            "title": spec["title"],
            "domain": spec["domain"],
            "description": spec["description"],
            "prompt": payload.description,
            "mode": spec["kind"],  # template | app
            "spec": spec,
            "generated_by_model": model,
        },
    )
    return row


_REFINE_EXTRA = """

——————————————
【本次是「迭代修改」模式】
下面会给你一台**已有训练器的完整 JSON** 和用户的**修改要求**。请在此基础上改：
- 只改用户要求的部分，其余尽量保留（标题/领域/已有题目/参数等不要无故丢失）。
- 输出**完整**的更新后 JSON（同一套 schema，顶层字段齐全），不要只输出 diff。
- 如果用户想要更强的灵活性 / 更复杂的交互，而当前模板表达不了，可以更换 template_id，
  或整体切换到 kind="app" 现场写一个更强的自包含交互式应用。
- 保持中文；跟读句子按目标语言。"""


async def refine(
    *, owner_id: str, spec_id: str, payload: RefinePracticeStudioRequest
) -> dict[str, Any]:
    """生成后用自然语言迭代修改：基于现有 spec + 指令，产出更新后的训练器并原地保存。"""
    current = repos.get_practice_spec(spec_id, owner_id)
    if not current:
        raise HTTPException(status_code=404, detail="训练器不存在")
    current_spec = current.get("spec")
    if not isinstance(current_spec, dict):
        raise HTTPException(status_code=400, detail="该训练器不支持在线修改")

    model = resolve_model(ModelTier.MEDIUM)
    user_prompt = (
        "【当前训练器 JSON】\n"
        + json.dumps(current_spec, ensure_ascii=False)
        + "\n\n【修改要求】\n"
        + payload.instruction.strip()
    )

    try:
        resp = await get_client().with_options(
            timeout=_GENERATE_REQUEST_TIMEOUT
        ).chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT + _REFINE_EXTRA},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5,
                response_format={"type": "json_object"},
                max_tokens=_GENERATE_MAX_TOKENS,
            )
        )
    except OpenAIAPIError as exc:
        logger.warning("practice studio refine llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"修改失败: {exc}") from exc

    text = resp.choices[0].message.content or ""
    try:
        spec = _normalize_trainer(_load_json(text))
    except Exception as exc:  # noqa: BLE001
        logger.warning("practice studio refine bad spec: %s\n%s", exc, text[:600])
        raise HTTPException(
            status_code=502, detail="修改结果结构异常，请换种说法再试"
        ) from exc

    row = repos.update_practice_spec(
        spec_id,
        owner_id,
        {
            "title": spec["title"],
            "domain": spec["domain"],
            "description": spec["description"],
            "mode": spec["kind"],
            "spec": spec,
            "generated_by_model": model,
        },
    )
    return row or current
