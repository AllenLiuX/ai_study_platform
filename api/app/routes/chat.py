"""Chat 路由:会话与消息。"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse

from ..agents.registry import all_agents
from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.chat import (
    ChatMessage,
    ChatSession,
    CreateSessionRequest,
    SendMessageRequest,
)
from ..services import chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/agents")
async def list_available_agents() -> list[dict]:
    """前端可用此接口动态拉取四个 Agent 的展示信息。"""
    return [
        {
            "agent_type": a.agent_type,
            "display_name": a.display_name,
            "subject_id": a.subject_id,
        }
        for a in all_agents()
    ]


@router.post("/sessions", response_model=ChatSession)
async def create_session(
    payload: CreateSessionRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return chat_service.create_chat_session(user_id=user.id, payload=payload)


@router.get("/sessions", response_model=list[ChatSession])
async def list_sessions(
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return chat_service.list_sessions(user.id)


@router.get(
    "/sessions/{session_id}/messages", response_model=list[ChatMessage]
)
async def list_session_messages(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return chat_service.list_messages(session_id, user.id)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    payload: SendMessageRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    """以 SSE 流式返回 assistant 回复。

    事件类型:
    - ready:     {"agent_type": "..."}
    - citations: {"items": [{material_id, material_title, chunk_index, similarity, snippet}, ...]}
                 在有 RAG 召回时,delta 之前先发一次,前端立即展示引用条
    - delta:     {"text": "..."}  增量文本片段
    - done:      {"length": N, "citation_count": M}
    - error:     {"message": "..."}
    """
    profile = repos.get_profile(user.id)
    return StreamingResponse(
        chat_service.stream_assistant_reply(
            session_id=session_id,
            user_id=user.id,
            user_content=payload.content,
            material_ids=payload.material_ids,
            student_profile=profile,
            background_tasks=background_tasks,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
