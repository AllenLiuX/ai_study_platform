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

from ..core.llm import ModelTier, get_client, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

_NOTE_SYSTEM = """你是一个 AI 学习平台的"笔记提取助手"。
学生刚和老师讨论完一个知识点,现在让你把这一轮对话蒸馏成一份"可复用的笔记"。

规则:
- 标题要点出核心知识点本身 (不是讨论过程),例如:"LRU 缓存淘汰策略"、"勾股定理的几何证明"
- summary 一句话浓缩 (≤ 40 字),便于后续 search / 列表展示
- content 是 markdown 正文,要点结构清晰:概念 → 关键性质 → 例子 / 推导 → 易错点。可以含 LaTeX (用 $...$ / $$...$$)。≤ 1500 字
- tags 给出 3-6 个标签 (与知识点领域相关,不要"对话"这类 meta 标签)
- 如果对话信息不足以形成有意义的笔记 (例如只是闲聊 / 老师还没解释完),设 insufficient=true 并简要说明

严格输出 JSON,不要 markdown 代码块包裹。字段:title / summary / content / tags / insufficient (bool) / insufficient_reason?
"""


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

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _NOTE_SYSTEM},
                {"role": "user", "content": transcript},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
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
