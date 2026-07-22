"""Phase 5: 从 chat 中蒸馏出"笔记 = 私有知识点"。

UI 入口:每条 assistant 消息下"📝 保存为笔记"按钮 → 调 generate_note_from_message
后台异步切片 + embed 由 notes_indexer 完成。
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
from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

_NOTE_SYSTEM = """你是一个 AI 学习平台的"笔记提取助手"。
学生刚和老师讨论完一个知识点,现在让你把这一轮对话蒸馏成一份"可复用的笔记"。

规则:
- 标题要点出核心知识点本身 (不是讨论过程),例如:"LRU 缓存淘汰策略"、"勾股定理的几何证明"
- summary 一句话浓缩 (≤ 40 字),便于后续 search / 列表展示
- content 是 markdown 正文,要点结构清晰:概念 → 关键性质 → 例子 / 推导 → 易错点。可以含 LaTeX (用 $...$ / $$...$$)。≤ 1500 字
- 如果对话里有"参考资料"区(可能来自联网搜索 / 上传资料 / 已有笔记),在 markdown 末尾加一段
  `## 参考资料` 列出来源(只保留对内容最相关的 3-5 条);带 URL 的写成 markdown 链接
- tags 给出 3-6 个标签 (与知识点领域相关,不要"对话"这类 meta 标签)
- 如果对话信息不足以形成有意义的笔记 (例如只是闲聊 / 老师还没解释完),设 insufficient=true 并简要说明

严格输出 JSON,不要 markdown 代码块包裹。字段:title / summary / content / tags / insufficient (bool) / insufficient_reason?
"""

_NOTE_FROM_SESSION_SYSTEM = """你是一个 AI 学习平台的"对话汇总助手"。
学生跟一位老师进行了完整的一段对话 (可能涵盖 1 个核心主题 + 若干相关知识点)。
你要把这整段对话蒸馏成一份"可复用的汇总笔记"。

规则:
- title 体现整段对话的核心学习主题 (不是过程),例如:"动态规划入门:子问题与记忆化"、
  "事件驱动量化系统设计要点";如果对话明显是多个独立小主题,可以用一个总括 title
- summary 一句话 (≤ 50 字) 浓缩学生这次学到了什么
- content 是 markdown 正文,要按"知识点 / 主题"分层级组织,推荐结构:
    ## 主题 1 标题
    - 概念 / 定义
    - 关键性质 / 推导
    - 易错点 / 实例

    ## 主题 2 标题
    ...

    ## 学到的核心结论
    - 关键 take-away 1
    - 关键 take-away 2

  正文长度 ≤ 3000 字,可以含 LaTeX ($...$ / $$...$$)。不要照搬对话原文 — 要重新组织、提炼。
- 如果对话出现了多个参考资料(网页 / 上传资料 / 已有笔记),在 markdown 末尾加一段
  `## 参考资料` 列出最相关的 3-8 条;带 URL 的写成 markdown 链接
- tags 给 3-8 个标签 (覆盖本次对话讨论的所有领域)
- 如果对话信息不足以形成有意义的笔记 (例如只是几句闲聊 / 学生还没真正开始问),设 insufficient=true

严格输出 JSON,不要 markdown 代码块包裹。字段:title / summary / content / tags / insufficient (bool) / insufficient_reason?
"""

# 限制喂给 LLM 的 transcript 总长度 (按字符近似),避免单次 session 太长爆 context
_SESSION_TRANSCRIPT_MAX_CHARS = 12_000
# 单条消息最长字符 — 截断后保留头 + 尾
_PER_MSG_MAX_CHARS = 1_500


def _safe_load_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, flags=re.S | re.I)
    if fence_match:
        text = fence_match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _fetch_message_pair(message_id: str, owner_id: str) -> tuple[dict, dict | None]:
    """返回 (assistant_message, prev_user_message);要求归属正确。

    根据 message_id 查 assistant 消息 + 同会话的"上一条 user 消息"。
    """
    client = get_admin_client()
    resp = (
        client.table("chat_messages")
        .select("*")
        .eq("id", message_id)
        .maybe_single()
        .execute()
    )
    assistant = resp.data if resp else None
    if not assistant or assistant.get("role") != "assistant":
        raise HTTPException(status_code=404, detail="消息不存在")
    session = repos.get_session(assistant["session_id"], owner_id)
    if not session:
        raise HTTPException(status_code=403, detail="无权访问该会话")

    # 找上一条 user 消息 (created_at < assistant.created_at, role=user, 最近一条)
    user_resp = (
        client.table("chat_messages")
        .select("*")
        .eq("session_id", assistant["session_id"])
        .eq("role", "user")
        .lt("created_at", assistant["created_at"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    prev_user = (user_resp.data or [None])[0]
    return assistant, prev_user


async def generate_note_from_message(
    *,
    owner_id: str,
    message_id: str,
    parent_id: str | None = None,
    tags_override: list[str] | None = None,
) -> dict:
    """从 chat 中一条 assistant 消息生成笔记。

    步骤:
    1. 取 (assistant, prev_user) 一对消息 + session 上下文
    2. 让 LLM 蒸馏成 (title, summary, content, tags)
    3. 落 knowledge_notes 行 (chunk_status='pending')
    4. 调用方拿到 note 后 add_task(process_note, note_id)
    """
    assistant, prev_user = _fetch_message_pair(message_id, owner_id)
    session_id = assistant["session_id"]
    agent_key = assistant.get("metadata", {}).get("agent_type") or None

    user_msg = (prev_user or {}).get("content") or ""
    assistant_msg = assistant.get("content") or ""

    transcript = (
        f"# 学生提问\n{user_msg.strip()}\n\n"
        f"# 老师回答\n{assistant_msg.strip()}"
    )

    # Phase 5.5: 如果这轮回答带了 citations (含 web / material / note),拼一段
    # "参考资料"喂给 LLM,让生成的笔记 markdown 末尾保留可点的来源链接
    citations = (assistant.get("metadata") or {}).get("citations") or []
    if citations:
        cite_lines: list[str] = []
        for i, c in enumerate(citations[:10], start=1):
            src = c.get("source") or "material"
            title = (
                c.get("source_title")
                or c.get("material_title")
                or c.get("note_title")
                or "(无标题)"
            )
            if src == "web":
                url = c.get("url") or c.get("source_id") or ""
                line = f"{i}. [{src}] [{title}]({url})" if url else f"{i}. [{src}] {title}"
            else:
                line = f"{i}. [{src}] {title}"
            cite_lines.append(line)
        if cite_lines:
            transcript += "\n\n# 参考资料 (本轮回答引用)\n" + "\n".join(cite_lines)

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _NOTE_SYSTEM},
                    {"role": "user", "content": transcript},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            ),
        )
    except OpenAIAPIError as exc:
        logger.warning("generate note llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {exc}") from exc

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("note llm bad json: %s\n%s", exc, text[:500])
        raise HTTPException(status_code=502, detail="LLM 输出格式异常,请重试") from exc

    if data.get("insufficient"):
        raise HTTPException(
            status_code=422,
            detail=data.get("insufficient_reason") or "对话信息不足以形成笔记",
        )

    title = str(data.get("title") or "").strip()[:200]
    summary = str(data.get("summary") or "").strip()[:500]
    content = str(data.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=502, detail="LLM 输出缺少 title / content")

    tags = tags_override
    if tags is None:
        tags = [
            str(t).strip()
            for t in (data.get("tags") or [])
            if str(t).strip()
        ][:20]

    payload = {
        "owner_id": owner_id,
        "agent_key": agent_key,
        "origin_session_id": session_id,
        "origin_message_id": message_id,
        "title": title,
        "summary": summary or None,
        "content": content,
        "tags": tags,
        "parent_id": parent_id,
        "source": "chat",
        "chunk_status": "pending",
    }
    return repos.insert_note(payload)


# =============================================================================
# 整段对话 → 一份汇总笔记 (复用同一 LLM 蒸馏管线,system prompt 不同)
# =============================================================================


def _truncate_middle(text: str, max_chars: int = _PER_MSG_MAX_CHARS) -> str:
    """单条消息超长时,保留头部 + 尾部,中段省略 — 既给上下文也给结论。"""
    if len(text) <= max_chars:
        return text
    keep = max_chars // 2 - 20
    return f"{text[:keep]}\n\n... [中段省略 {len(text) - 2 * keep} 字] ...\n\n{text[-keep:]}"


def _build_session_transcript(messages: list[dict]) -> tuple[str, list[dict]]:
    """把 session 的所有有效消息拼成 transcript + 收集所有 citations 去重。

    过滤:
      - role=system / kind=welcome (内置欢迎语) — 不算讨论内容
      - 内容为空的消息
    """
    seen_cite_keys: set[str] = set()
    aggregated_citations: list[dict] = []
    turns: list[str] = []
    user_idx = assistant_idx = 0

    for msg in messages:
        role = msg.get("role")
        meta = msg.get("metadata") or {}
        if role == "system":
            continue
        if meta.get("kind") == "welcome":
            continue
        content = (msg.get("content") or "").strip()
        if not content:
            continue

        if role == "user":
            user_idx += 1
            turns.append(
                f"## 学生 (轮 {user_idx})\n{_truncate_middle(content)}"
            )
        elif role == "assistant":
            assistant_idx += 1
            turns.append(
                f"## 老师 (轮 {assistant_idx})\n{_truncate_middle(content)}"
            )
            # 聚合 citations
            for c in (meta.get("citations") or []):
                key = (
                    c.get("url")
                    or c.get("source_id")
                    or c.get("material_id")
                    or c.get("note_id")
                    or (c.get("source"), c.get("source_title"))
                )
                if not key or key in seen_cite_keys:
                    continue
                seen_cite_keys.add(key)
                aggregated_citations.append(c)

    transcript = "\n\n".join(turns)
    # 整体二次截断 — 头尾各占一半,保留学习开始 + 学习结论
    if len(transcript) > _SESSION_TRANSCRIPT_MAX_CHARS:
        keep = _SESSION_TRANSCRIPT_MAX_CHARS // 2 - 50
        transcript = (
            f"{transcript[:keep]}\n\n"
            f"... [整段对话中段省略 {len(transcript) - 2 * keep} 字,以保留首尾上下文] ...\n\n"
            f"{transcript[-keep:]}"
        )

    return transcript, aggregated_citations


def _citations_block(citations: list[dict], *, limit: int = 10) -> str:
    """把聚合的 citations 拼成 markdown 段,塞进 transcript 末尾让 LLM 看到。"""
    if not citations:
        return ""
    lines: list[str] = []
    for i, c in enumerate(citations[:limit], start=1):
        src = c.get("source") or "material"
        title = (
            c.get("source_title")
            or c.get("material_title")
            or c.get("note_title")
            or "(无标题)"
        )
        if src == "web":
            url = c.get("url") or c.get("source_id") or ""
            line = f"{i}. [{src}] [{title}]({url})" if url else f"{i}. [{src}] {title}"
        else:
            line = f"{i}. [{src}] {title}"
        lines.append(line)
    return "\n\n# 参考资料 (整段对话累计引用)\n" + "\n".join(lines)


async def generate_note_from_session(
    *,
    owner_id: str,
    session_id: str,
    parent_id: str | None = None,
    tags_override: list[str] | None = None,
) -> dict:
    """把整段对话蒸馏为一份汇总笔记。

    步骤:
    1. 拉 session 全消息,过滤 welcome / system
    2. 拼 user / assistant 交替的 transcript + 聚合所有 citations
    3. LLM (MEDIUM tier) 输出 title / summary / content / tags
    4. 落 knowledge_notes 行 (origin_message_id = 最后一条 assistant)
    """
    session = repos.get_session(session_id, owner_id)
    if not session:
        raise HTTPException(status_code=404, detail="对话不存在或无权访问")

    messages = repos.list_messages(session_id)
    if not messages:
        raise HTTPException(status_code=422, detail="该对话还没有任何消息")

    transcript, citations = _build_session_transcript(messages)
    if not transcript.strip():
        raise HTTPException(
            status_code=422, detail="对话内容为空,无法蒸馏笔记"
        )

    # 计算 origin_message_id = 最后一条 assistant message (供前端回溯)
    last_assistant_id: str | None = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and (msg.get("content") or "").strip():
            last_assistant_id = msg.get("id")
            break

    full_input = transcript + _citations_block(citations)

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _NOTE_FROM_SESSION_SYSTEM},
                    {"role": "user", "content": full_input},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            ),
        )
    except OpenAIAPIError as exc:
        logger.warning("generate note from session llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {exc}") from exc

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("session note llm bad json: %s\n%s", exc, text[:500])
        raise HTTPException(status_code=502, detail="LLM 输出格式异常,请重试") from exc

    if data.get("insufficient"):
        raise HTTPException(
            status_code=422,
            detail=data.get("insufficient_reason") or "对话信息不足以形成笔记",
        )

    title = str(data.get("title") or "").strip()[:200]
    summary = str(data.get("summary") or "").strip()[:500]
    content = str(data.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=502, detail="LLM 输出缺少 title / content")

    tags = tags_override
    if tags is None:
        tags = [
            str(t).strip()
            for t in (data.get("tags") or [])
            if str(t).strip()
        ][:20]

    payload = {
        "owner_id": owner_id,
        "agent_key": session.get("agent_type"),
        "origin_session_id": session_id,
        "origin_message_id": last_assistant_id,
        "title": title,
        "summary": summary or None,
        "content": content,
        "tags": tags,
        "parent_id": parent_id,
        "source": "chat",
        "chunk_status": "pending",
    }
    return repos.insert_note(payload)


# =============================================================================
# Phase 6.1: 练习 → 复习笔记 (复用同一 LLM 蒸馏管线)
# =============================================================================

_NOTE_FROM_PRACTICE_SYSTEM = """你是一个 AI 学习平台的"练习复习笔记助手"。
学生刚完成一次针对性练习 (每道题含:题目 / 标准答案 / 学生作答 / 对错 / 解析)。
你要把这次练习蒸馏成一份**面向复习的知识点笔记** — 学生以后翻这份笔记就能
快速重温这次练习覆盖的知识点,尤其是踩过的坑。

规则:
- title 体现练习主题,例如:"量化系统设计练习复盘:撮合引擎与一致性"
- summary 一句话 (≤ 50 字):练了什么 + 最大的薄弱点
- content 是 markdown 正文,按知识点组织 (不是按题号!),推荐结构:
    ## 知识点 A
    - 核心结论 / 原理 (从题目和解析中提炼,写成可独立阅读的知识)
    - ⚠️ 踩过的坑:学生答错的点 + 为什么错 + 正确思路 (没答错可省略)

    ## 知识点 B
    ...

    ## 复习清单
    - [ ] 需要重点复习的薄弱知识点 (按错误率排)
    - [ ] 已掌握但值得隔期重温的点

  正文 ≤ 3000 字,可含 LaTeX ($...$ / $$...$$)。
  重点提炼"知识本身"而非"做题过程";答错的题要把错误选项为什么有迷惑性讲透。
- tags 给 3-8 个标签 (领域相关,不要"练习"这类 meta 标签)
- 如果练习信息太少 (例如只做了 1-2 道且都跳过),设 insufficient=true

严格输出 JSON,不要 markdown 代码块包裹。字段:title / summary / content / tags / insufficient (bool) / insufficient_reason?
"""


def _format_answer_for_note(answer: Any) -> str:
    """把题目 answer (str / list / dict) 拍平成可读文本。"""
    if answer is None:
        return "(无)"
    if isinstance(answer, str):
        return answer
    if isinstance(answer, list):
        return " / ".join(str(x) for x in answer)
    if isinstance(answer, dict):
        ref = answer.get("reference") or ""
        rubric = answer.get("rubric") or ""
        parts = [p for p in (ref, rubric and f"评分要点:{rubric}") if p]
        return "\n".join(str(p) for p in parts) or json.dumps(answer, ensure_ascii=False)
    return str(answer)


def _build_practice_transcript(
    session: dict, questions: list[dict], attempts_by_qid: dict[str, dict]
) -> str:
    """把一次练习的全部信息拼成 LLM 输入。"""
    parts: list[str] = [
        f"# 练习主题:{session['topic']}",
    ]
    if session.get("plan"):
        parts.append(f"## 练习计划\n{_truncate_middle(session['plan'], 800)}")

    summary = session.get("summary") or {}
    kp_stats = summary.get("kp_stats") or {}
    if kp_stats:
        stat_lines = [
            f"- {kp}: 对 {s.get('correct', 0)} / 错 {s.get('wrong', 0)}"
            for kp, s in kp_stats.items()
        ]
        parts.append("## 知识点表现统计\n" + "\n".join(stat_lines))

    for q in questions:
        att = attempts_by_qid.get(q["id"]) or {}
        if att.get("skipped"):
            verdict = "跳过"
        elif att.get("is_correct") is True:
            verdict = "✓ 答对"
        elif att.get("is_correct") is False:
            verdict = "✗ 答错"
        elif att.get("score") is not None:
            verdict = f"评分 {att['score']}/10"
        else:
            verdict = "未答"

        lines = [
            f"## 第 {q['idx']} 题 [{q['kind']} | 难度 {q['difficulty']} | "
            f"知识点: {', '.join(q.get('knowledge_points') or []) or '-'} | {verdict}]",
            f"题目:{_truncate_middle(q['prompt'], 600)}",
        ]
        if q.get("options"):
            opts = "; ".join(
                f"{o.get('id')}. {o.get('text')}" for o in q["options"]
            )
            lines.append(f"选项:{_truncate_middle(opts, 400)}")
        lines.append(f"标准答案:{_truncate_middle(_format_answer_for_note(q.get('answer')), 400)}")
        if att.get("user_answer") is not None:
            ua = att["user_answer"]
            ua_text = ", ".join(str(x) for x in ua) if isinstance(ua, list) else str(ua)
            lines.append(f"学生作答:{_truncate_middle(ua_text, 300)}")
        if att.get("feedback"):
            lines.append(f"AI 评语:{_truncate_middle(att['feedback'], 300)}")
        if q.get("explanation"):
            lines.append(f"解析:{_truncate_middle(q['explanation'], 500)}")
        if att.get("hints_used"):
            lines.append(f"(用了 {att['hints_used']} 次提示)")
        parts.append("\n".join(lines))

    transcript = "\n\n".join(parts)
    if len(transcript) > _SESSION_TRANSCRIPT_MAX_CHARS:
        keep = _SESSION_TRANSCRIPT_MAX_CHARS // 2 - 50
        transcript = (
            f"{transcript[:keep]}\n\n"
            f"... [中段省略 {len(transcript) - 2 * keep} 字] ...\n\n"
            f"{transcript[-keep:]}"
        )
    return transcript


async def generate_note_from_practice(
    *,
    owner_id: str,
    practice_session_id: str,
    parent_id: str | None = None,
    tags_override: list[str] | None = None,
) -> dict:
    """把一次练习 (题目 + 作答 + 解析 + 统计) 蒸馏为一份复习笔记。"""
    session = repos.get_practice_session(practice_session_id, owner_id)
    if not session:
        raise HTTPException(status_code=404, detail="练习不存在或无权访问")

    questions = repos.list_practice_questions(practice_session_id)
    if not questions:
        raise HTTPException(status_code=422, detail="该练习还没有任何题目")

    attempts = repos.list_practice_attempts([q["id"] for q in questions])
    attempts_by_qid: dict[str, dict] = {}
    for a in attempts:
        attempts_by_qid[a["question_id"]] = a  # 取最新

    answered = [
        q for q in questions
        if q["id"] in attempts_by_qid and not attempts_by_qid[q["id"]].get("skipped")
    ]
    if not answered:
        raise HTTPException(status_code=422, detail="还没有作答任何题目,先做几道再整理")

    transcript = _build_practice_transcript(session, questions, attempts_by_qid)

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _NOTE_FROM_PRACTICE_SYSTEM},
                    {"role": "user", "content": transcript},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            ),
        )
    except OpenAIAPIError as exc:
        logger.warning("generate note from practice llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {exc}") from exc

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("practice note llm bad json: %s\n%s", exc, text[:500])
        raise HTTPException(status_code=502, detail="LLM 输出格式异常,请重试") from exc

    if data.get("insufficient"):
        raise HTTPException(
            status_code=422,
            detail=data.get("insufficient_reason") or "练习信息不足以形成笔记",
        )

    title = str(data.get("title") or "").strip()[:200]
    summary = str(data.get("summary") or "").strip()[:500]
    content = str(data.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=502, detail="LLM 输出缺少 title / content")

    tags = tags_override
    if tags is None:
        tags = [str(t).strip() for t in (data.get("tags") or []) if str(t).strip()][:20]

    payload = {
        "owner_id": owner_id,
        "agent_key": session.get("agent_key"),
        # origin_session_id 的 FK 指向 chat_sessions,练习笔记不挂
        "title": title,
        "summary": summary or None,
        "content": content,
        "tags": tags,
        "parent_id": parent_id,
        "source": "practice",
        "chunk_status": "pending",
    }
    return repos.insert_note(payload)


# =============================================================================
# Phase 6.2: 听课转写 → 复习笔记 (复用同一 LLM 蒸馏管线)
# =============================================================================

_NOTE_FROM_LECTURE_SYSTEM = """你是一个 AI 学习平台的"音频转写复习笔记助手"。
用户刚录完一段音频(可能是学校课堂 / 网课 / 讲座 / 直播 / 播客 / 会议 / 访谈
/ 视频教程等任何形式),把原始音频用 ASR 转成了一份纯文本 (含时间戳 [MM:SS],
可能有识别错字 / 断句奇怪 / 说话人口头禅 "这个""就是"等)。

你要把这段转写蒸馏成一份**面向复用的学习笔记**,让用户日后翻这份笔记
就能快速回顾核心内容、要点、金句 / 关键结论、可执行的 take-away。

## 规则
- 首先自己判断这是什么类型的内容 (学科课 / 直播带货 / 商业访谈 / 播客 / …),
  按最贴合的结构组织正文,不要生搬硬套一个模板。
- title 一句话点出核心主题,例如:
  - 学科课:"高一物理:自由落体运动的规律与例题"
  - 带货直播:"XX 主播美妆专场话术拆解 & 爆款推荐节奏"
  - 商业访谈:"YY 谈量化对冲基金的风控框架"
  - 播客:"关于 SaaS 定价的三个反直觉观点"
- summary 一句话 (≤ 50 字):这段音频最值得记住的一件事
- content 是 markdown 正文 (≤ 3000 字,可含 LaTeX $...$ / $$...$$)。
  **不要照搬原转写** — 要重新组织、精炼、去口头禅和识别错字;
  按内容类型灵活组织,常见结构可参考:
  - 学科/知识型: 概念 → 推导/原理 → 例题 → 易错点 → 复习清单
  - 直播/带货: 开场话术 → 产品切入节奏 → 卖点组合 → 促单话术 → 可复用套路
  - 访谈/播客: 核心观点 → 支撑论据 → 反驳/case → 值得深挖的问题
  - 会议/复盘: 决策 → 依据 → 未决 → 行动项
- 如果用户提供了"关注角度",严格按那个视角侧重,避免写他不关心的部分
- 如果指定了"扮演的老师",用该老师的知识面和讲解风格来组织笔记
  (比如"带货直播分析师"会更关注话术套路而非产品参数)
- tags 3-8 个,与内容领域紧密相关,不要 "听课""音频"这类 meta 标签
- **只有在原始转写完全为空 (< 50 字) / 只有噪音字符 / 完全无语义** 时
  才设 insufficient=true。护肤品广告 / 直播带货 / 闲聊 / 播客都算合法内容,
  务必尝试蒸馏,不要因为"这不像上课"就拒绝

严格输出 JSON,不要 markdown 代码块包裹。
字段:title / summary / content / tags / insufficient (bool) / insufficient_reason?
"""


async def generate_note_from_transcript(
    *,
    owner_id: str,
    transcript: str,
    title_hint: str | None = None,
    agent_key: str | None = None,
    focus_hint: str | None = None,
    parent_id: str | None = None,
    tags_override: list[str] | None = None,
    keep_raw_transcript: bool = True,
) -> dict:
    """把一段课堂转写蒸馏为一份复习笔记。

    转写文本可能很长 (60min 一节课约 8-12k 字),做 head/tail 截断避免超 LLM 上限。
    keep_raw_transcript=True 时,会把原始转写 (截断后) 作为附录附在笔记 markdown 末尾,
    方便学生对照检查、修正笔记内容。
    """
    if not transcript or not transcript.strip():
        raise HTTPException(status_code=400, detail="转写文本为空,无法生成笔记")

    raw = transcript.strip()

    # 可选:让指定的"老师" (agent) 参与蒸馏 — 用其人设的知识面 & 讲解风格
    system_prompt = _NOTE_FROM_LECTURE_SYSTEM
    resolved_agent_key: str | None = None
    if agent_key:
        try:
            from ..agents.registry import resolve_agent

            agent = resolve_agent(agent_key, owner_id=owner_id)
            resolved_agent_key = agent.key
            persona = (agent.inline_system_prompt or "").strip()
            persona_intro = (
                f"## 你扮演的老师\n"
                f"你是「{agent.name}」({agent.tagline or agent.role or '专家'})。\n"
                f"用这位老师的知识面、术语偏好、讲解风格来重新组织下面这份笔记。\n"
                f"人设详细描述如下(仅用作视角,不要在笔记里复读):\n{persona}\n"
            )
            system_prompt = f"{_NOTE_FROM_LECTURE_SYSTEM}\n\n{persona_intro}"
        except Exception as exc:
            logger.warning(
                "generate note from lecture: agent %s resolve failed: %s (fallback 到通用)",
                agent_key,
                exc,
            )

    user_input_parts: list[str] = []
    if title_hint:
        user_input_parts.append(f"# 用户给的标题提示\n{title_hint.strip()[:200]}")
    if focus_hint:
        user_input_parts.append(
            f"# 用户的关注角度 / 学习目标 (务必侧重这个视角)\n{focus_hint.strip()[:800]}"
        )
    user_input_parts.append(
        f"# 音频原始转写 (可能含识别噪音;方括号里是 MM:SS 时间戳)\n"
        f"{_truncate_middle(raw, _SESSION_TRANSCRIPT_MAX_CHARS)}"
    )
    user_input = "\n\n".join(user_input_parts)

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_input},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            ),
        )
    except OpenAIAPIError as exc:
        logger.warning("generate note from lecture llm failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {exc}") from exc

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("lecture note llm bad json: %s\n%s", exc, text[:500])
        raise HTTPException(status_code=502, detail="LLM 输出格式异常,请重试") from exc

    if data.get("insufficient"):
        raise HTTPException(
            status_code=422,
            detail=data.get("insufficient_reason") or "转写内容不足以形成笔记",
        )

    title = str(data.get("title") or title_hint or "").strip()[:200]
    summary = str(data.get("summary") or "").strip()[:500]
    content = str(data.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=502, detail="LLM 输出缺少 title / content")

    # 附录:保留原始转写便于对照 (小屏可折叠 <details>)
    if keep_raw_transcript:
        # 限制附录长度,防止一份笔记撑爆 20k 字限制
        appendix_raw = _truncate_middle(raw, 6000)
        content += (
            "\n\n---\n\n"
            "<details>\n"
            "<summary>📼 原始录音转写(供对照,可能有识别错字)</summary>\n\n"
            f"{appendix_raw}\n\n"
            "</details>\n"
        )
        # 保底不超过 note 表 content 上限
        if len(content) > 19_500:
            content = content[:19_500] + "\n\n...(转写附录被截断)"

    tags = tags_override
    if tags is None:
        tags = [str(t).strip() for t in (data.get("tags") or []) if str(t).strip()][:20]

    payload = {
        "owner_id": owner_id,
        "agent_key": resolved_agent_key,
        "title": title,
        "summary": summary or None,
        "content": content,
        "tags": tags,
        "parent_id": parent_id,
        "source": "lecture",
        "chunk_status": "pending",
    }
    return repos.insert_note(payload)
