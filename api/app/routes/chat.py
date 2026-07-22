"""Chat 路由:会话 / 消息 / 图片附件。"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.responses import StreamingResponse

from ..agents.registry import all_agents
from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..db.supabase_client import get_admin_client
from ..schemas.chat import (
    ChatAttachment,
    ChatMessage,
    ChatSession,
    CreateSessionRequest,
    SendMessageRequest,
)
from ..services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Phase 4: 图片对话上限
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 单张图 5MB
ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
CHAT_BUCKET = "chat-attachments"


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


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """硬删 session + 关联 messages (FK ON DELETE CASCADE)。"""
    ok = chat_service.delete_session(session_id=session_id, user_id=user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="对话不存在或无权删除")


@router.get(
    "/sessions/{session_id}/messages", response_model=list[ChatMessage]
)
async def list_session_messages(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return chat_service.list_messages(session_id, user.id)


@router.post("/attachments", response_model=ChatAttachment)
async def upload_chat_attachment(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> ChatAttachment:
    """学生上传一张题目图片 (Phase 4)。

    - 校验 mime / size
    - 写入 Storage bucket `chat-attachments/<user_id>/<uuid>.<ext>`
    - 返回 storage_path,前端拿到后塞到 send_message 的 image_urls 里
    - 不创建独立 DB row;图片信息只挂在 chat_messages.metadata.image_urls
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名缺失")
    mime = (file.content_type or mimetypes.guess_type(file.filename)[0] or "").lower()
    if mime not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"图片格式不支持:{mime or 'unknown'};仅支持 PNG/JPG/WEBP/GIF",
        )
    data = await file.read()
    size_bytes = len(data)
    if size_bytes == 0:
        raise HTTPException(status_code=400, detail="文件为空")
    if size_bytes > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"图片过大 ({size_bytes/1024/1024:.1f}MB),单张上限 {MAX_IMAGE_BYTES // 1024 // 1024}MB",
        )

    # 选扩展名:用 mime 推断,避免学生上传 "题目.JPG" 大小写不一致的问题
    ext_map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    ext = ext_map.get(mime, "png")
    storage_path = f"{user.id}/{uuid.uuid4()}.{ext}"

    client = get_admin_client()
    try:
        await asyncio.to_thread(
            lambda: client.storage.from_(CHAT_BUCKET).upload(
                storage_path,
                data,
                file_options={"content-type": mime, "upsert": "false"},
            )
        )
    except Exception as exc:
        logger.exception("chat attachment upload to storage failed")
        raise HTTPException(
            status_code=502,
            detail=f"上传到 Storage 失败: {exc}",
        ) from exc

    return ChatAttachment(
        storage_path=storage_path,
        mime_type=mime,
        size_bytes=size_bytes,
        original_filename=file.filename,
    )


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
    # Phase 8 · Billing: 免费用户每日消息数 + 模型档位限制
    from ..services import entitlements as ents
    ents.enforce("chat_messages_per_day", user.id)
    ents.enforce_model_tier(user.id, payload.model_tier)

    profile = repos.get_profile(user.id)
    return StreamingResponse(
        chat_service.stream_assistant_reply(
            session_id=session_id,
            user_id=user.id,
            user_content=payload.content,
            material_ids=payload.material_ids,
            student_profile=profile,
            background_tasks=background_tasks,
            model_tier=payload.model_tier,
            image_urls=payload.image_urls,
            web_search=payload.web_search,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
