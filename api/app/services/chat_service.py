"""Chat 业务层:粘合 agent runtime 与数据库。"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import HTTPException, status

from ..agents.registry import AgentConfig, get_agent
from ..agents.runtime import stream_reply
from ..db import repos
from ..schemas.chat import CreateSessionRequest
from .retrieval import RetrievedChunk, format_context, retrieve_chunks

logger = logging.getLogger(__name__)


def _default_session_title(agent: AgentConfig) -> str:
    return f"{agent.display_name} 的对话"


def create_chat_session(*, user_id: str, payload: CreateSessionRequest) -> dict:
    try:
        agent = get_agent(payload.agent_type)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    title = payload.title or _default_session_title(agent)
    subject_id = payload.subject_id or agent.subject_id
    session = repos.create_session(
        student_id=user_id,
        agent_type=agent.agent_type,
        subject_id=subject_id,
        title=title,
    )

    if agent.welcome_message:
        repos.insert_message(
            session_id=session["id"],
            role="assistant",
            content=agent.welcome_message,
            metadata={"kind": "welcome"},
        )
    return session


def get_session_or_404(session_id: str, user_id: str) -> dict:
    session = repos.get_session(session_id, user_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在或无权访问",
        )
    return session


def list_messages(session_id: str, user_id: str) -> list[dict]:
    get_session_or_404(session_id, user_id)
    return repos.list_messages(session_id)


def list_sessions(user_id: str) -> list[dict]:
    return repos.list_sessions(user_id)


def _citation_payload(chunks: list[RetrievedChunk]) -> list[dict]:
    return [
        {
            "material_id": c.material_id,
            "material_title": c.material_title,
            "chunk_index": c.chunk_index,
            "similarity": round(c.similarity, 4),
            "snippet": c.content[:160],
        }
        for c in chunks
    ]


async def stream_assistant_reply(
    *,
    session_id: str,
    user_id: str,
    user_content: str,
    material_ids: list[str] | None,
    student_profile: dict | None,
) -> AsyncIterator[str]:
    """流式生成 assistant 回复。

    yield 出去的是 SSE event 字符串(已经包含 `event: ...\\ndata: ...\\n\\n`)。

    流程:
    1. 校验会话归属
    2. 落库 user message (在 metadata.material_ids 中标注引用了哪些资料)
    3. 取历史
    4. 若提供 material_ids,做 RAG 召回 → 发送 citations 事件
    5. 调 LLM stream
    6. 累计完整文本后落库 assistant message,citations 写入 metadata
    """
    session = get_session_or_404(session_id, user_id)
    agent = get_agent(session["agent_type"])

    user_meta: dict = {}
    if material_ids:
        user_meta["material_ids"] = material_ids
    repos.insert_message(
        session_id=session_id,
        role="user",
        content=user_content,
        metadata=user_meta or None,
    )

    history = repos.list_messages(session_id)

    assistant_text_parts: list[str] = []
    citations: list[RetrievedChunk] = []
    try:
        yield _sse("ready", {"agent_type": agent.agent_type})

        rag_context: str | None = None
        if material_ids is not None and len(material_ids) > 0:
            try:
                citations = await retrieve_chunks(
                    query=user_content,
                    owner_id=user_id,
                    material_ids=material_ids,
                    top_k=5,
                )
            except Exception as exc:
                logger.warning("RAG retrieval failed: %s", exc)
                yield _sse(
                    "warning",
                    {"message": f"资料检索失败,本次将基于通识知识回答 ({exc})"},
                )
                citations = []

            if citations:
                rag_context = format_context(citations)
                yield _sse("citations", {"items": _citation_payload(citations)})
            else:
                yield _sse(
                    "warning",
                    {"message": "未在选中的资料里找到与问题相关的内容,本次将基于通识知识回答"},
                )

        async for delta in stream_reply(
            agent=agent,
            history=history,
            student_profile=student_profile,
            rag_context=rag_context,
        ):
            assistant_text_parts.append(delta)
            yield _sse("delta", {"text": delta})

        full_text = "".join(assistant_text_parts).strip()
        if full_text:
            assistant_meta: dict = {
                "model_tier": agent.tier.value,
                "agent_type": agent.agent_type,
            }
            if citations:
                assistant_meta["citations"] = _citation_payload(citations)
            repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=full_text,
                metadata=assistant_meta,
            )

        if not session.get("title") or session.get("title", "").endswith("的对话"):
            short_title = user_content.strip().splitlines()[0][:20]
            if short_title:
                repos.touch_session(session_id, title=short_title)
            else:
                repos.touch_session(session_id)
        else:
            repos.touch_session(session_id)

        yield _sse(
            "done",
            {"length": len(full_text), "citation_count": len(citations)},
        )
    except Exception as exc:
        logger.exception("LLM stream failed")
        partial = "".join(assistant_text_parts).strip()
        if partial:
            repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=partial + "\n\n(回复中断,请重试)",
                metadata={"error": str(exc), "partial": True},
            )
        yield _sse("error", {"message": str(exc)})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
