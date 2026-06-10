"""Chat 业务层:粘合 agent runtime 与数据库。"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import BackgroundTasks, HTTPException, status

from ..agents.registry import AgentConfig, get_agent
from ..agents.runtime import stream_reply
from ..core.llm import ModelTier, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client
from ..schemas.chat import CreateSessionRequest
from .progress_extractor import extract_and_update
from .retrieval import RetrievedChunk, format_context, retrieve_chunks
from .suggester import suggest_follow_ups

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
    background_tasks: BackgroundTasks | None = None,
    model_tier: str | None = None,
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
    # Phase 3.5: 学生临时选择的 tier 优先,否则用 agent 默认
    try:
        effective_tier: ModelTier = (
            ModelTier(model_tier) if model_tier else agent.tier
        )
    except ValueError:
        logger.warning("非法 model_tier=%s,回落到 agent 默认", model_tier)
        effective_tier = agent.tier
    try:
        model_name = resolve_model(effective_tier)
        yield _sse(
            "ready",
            {
                "agent_type": agent.agent_type,
                "model": model_name,
                "model_tier": effective_tier.value,
            },
        )

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
            tier=effective_tier,
        ):
            assistant_text_parts.append(delta)
            yield _sse("delta", {"text": delta})

        full_text = "".join(assistant_text_parts).strip()
        assistant_message_id: str | None = None
        if full_text:
            assistant_meta: dict = {
                "model_tier": effective_tier.value,
                "model": model_name,
                "agent_type": agent.agent_type,
            }
            if citations:
                assistant_meta["citations"] = _citation_payload(citations)
            assistant_row = repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=full_text,
                metadata=assistant_meta,
            )
            assistant_message_id = assistant_row.get("id") if assistant_row else None

        # Phase 2: 学科老师对话结束后,异步抽取学生掌握度 (head_teacher 跳过)
        subject_id = session.get("subject_id") or agent.subject_id
        if (
            background_tasks is not None
            and full_text
            and subject_id
            and agent.agent_type != "head_teacher"
        ):
            subject_row = next(
                (s for s in repos.list_subjects() if s["id"] == subject_id), None
            )
            background_tasks.add_task(
                extract_and_update,
                student_id=user_id,
                subject_id=subject_id,
                subject_name=(subject_row or {}).get("name", subject_id),
                session_id=session_id,
                assistant_message_id=assistant_message_id,
                user_msg=user_content,
                assistant_msg=full_text,
            )

        # Phase 2.5: 主回答 streaming 完成后 inline 生成「下一步建议」,
        # 通过 SSE follow_ups 事件推送,并持久化到 assistant.metadata.follow_ups
        if full_text:
            try:
                follow_ups = await suggest_follow_ups(
                    student_id=user_id,
                    agent=agent,
                    subject_id=subject_id,
                    user_msg=user_content,
                    assistant_msg=full_text,
                )
            except Exception as exc:
                logger.warning("suggest_follow_ups 失败: %s", exc)
                follow_ups = []

            if follow_ups:
                items = [fu.model_dump() for fu in follow_ups]
                yield _sse("follow_ups", {"items": items})
                if assistant_message_id:
                    try:
                        client = get_admin_client()
                        current = (
                            client.table("chat_messages")
                            .select("metadata")
                            .eq("id", assistant_message_id)
                            .maybe_single()
                            .execute()
                        )
                        md = (current.data or {}).get("metadata") or {}
                        md["follow_ups"] = items
                        client.table("chat_messages").update({"metadata": md}).eq(
                            "id", assistant_message_id
                        ).execute()
                    except Exception as exc:
                        logger.warning("写回 follow_ups 失败: %s", exc)

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
            {
                "length": len(full_text),
                "citation_count": len(citations),
                "model": model_name,
                "model_tier": effective_tier.value,
            },
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
