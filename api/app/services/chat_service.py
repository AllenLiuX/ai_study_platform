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


async def stream_assistant_reply(
    *,
    session_id: str,
    user_id: str,
    user_content: str,
    student_profile: dict | None,
) -> AsyncIterator[str]:
    """流式生成 assistant 回复。

    yield 出去的是 SSE event 字符串(已经包含 `data: ...\\n\\n`)。

    流程:
    1. 校验会话归属
    2. 落库 user message
    3. 取历史
    4. 调 LLM stream
    5. 累计完整文本后落库 assistant message
    """
    session = get_session_or_404(session_id, user_id)
    agent = get_agent(session["agent_type"])

    repos.insert_message(
        session_id=session_id, role="user", content=user_content
    )

    history = repos.list_messages(session_id)

    try:
        assistant_text_parts: list[str] = []
        # 首先发送一个 ready event,让前端知道流已建立
        yield _sse("ready", {"agent_type": agent.agent_type})

        async for delta in stream_reply(
            agent=agent, history=history, student_profile=student_profile
        ):
            assistant_text_parts.append(delta)
            yield _sse("delta", {"text": delta})

        full_text = "".join(assistant_text_parts).strip()
        if full_text:
            repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=full_text,
                metadata={"model_tier": agent.tier.value},
            )
        # 自动补 session title:用第一条 user message 的前 20 个字
        if not session.get("title") or session.get("title", "").endswith("的对话"):
            short_title = user_content.strip().splitlines()[0][:20]
            if short_title:
                repos.touch_session(session_id, title=short_title)
            else:
                repos.touch_session(session_id)
        else:
            repos.touch_session(session_id)

        yield _sse("done", {"length": len(full_text)})
    except Exception as exc:
        logger.exception("LLM stream failed")
        # 把已经收到的部分也落库,避免学生看到一段回复刷新就丢
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
