"""Phase 6.2: 听课 (Lecture) — 录音实时转写 + 保存为复习笔记。

设计:
- POST /lecture/transcribe (multipart audio) → {"text": str}
    前端 MediaRecorder 每 ~12s 输出一个完整音频段,直传本接口,
    透传给 OpenAI Whisper 返回文本。无状态,不落库。
- POST /lecture/save (JSON {transcript, title_hint?, tags?}) → KnowledgeNote
    整堂课录完后,把累积的完整转写送 LLM 蒸馏成结构化笔记入 knowledge_notes,
    source='lecture',后台异步 embed 索引 (与练习/对话笔记同一 chunk_status 管线)。

跟 notes/from_practice 保持一样的返回 shape,方便前端复用 KnowledgeNote 组件。
"""

from __future__ import annotations

import logging

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from openai import APIError as OpenAIAPIError

from ..core.auth import CurrentUser, get_current_user
from ..routes.notes import _to_note
from ..schemas.note import GenerateNoteFromLectureRequest, KnowledgeNote
from ..services import notes_indexer, notes_service, transcription_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lecture", tags=["lecture"])

# 单段音频硬上限 25MB (Whisper endpoint 上限);典型 12s webm ~ 100KB,
# 这里主要防止未来支持整段上传或异常大 chunk
_MAX_CHUNK_BYTES = 25 * 1024 * 1024

# 允许的音频 MIME 前缀 — 浏览器 MediaRecorder 在不同环境下会给不同类型
_ALLOWED_AUDIO_PREFIXES = ("audio/",)


@router.post("/transcribe")
async def transcribe_chunk(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """接收一段音频,返回转写文本。

    返回:{"text": str, "chars": int}
    - text 可能为空字符串 (整段静音也是合法情况),前端应正常拼接
    - 失败抛 400 / 413 / 502
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")
    mime = (file.content_type or "").lower()
    if mime and not any(mime.startswith(p) for p in _ALLOWED_AUDIO_PREFIXES):
        # 浏览器有时给 application/octet-stream,不硬拒;只有当明确非 audio 才拦
        if mime not in {"application/octet-stream", ""}:
            raise HTTPException(
                status_code=400,
                detail=f"仅接受音频类型,收到 {mime}",
            )

    data = await file.read()
    size = len(data)
    if size == 0:
        raise HTTPException(status_code=400, detail="音频段为空")
    if size > _MAX_CHUNK_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"音频段过大 ({size / 1024 / 1024:.1f}MB),上限 "
            f"{_MAX_CHUNK_BYTES // 1024 // 1024}MB",
        )

    try:
        text = await transcription_service.transcribe_audio(
            data=data,
            filename=file.filename,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OpenAIAPIError as exc:
        logger.warning("whisper failed for user=%s size=%dB: %s", user.id, size, exc)
        raise HTTPException(status_code=502, detail=f"转写失败: {exc}") from exc
    except Exception as exc:
        logger.exception("transcribe_chunk unexpected failure")
        raise HTTPException(status_code=500, detail=f"转写异常: {exc}") from exc

    return {"text": text, "chars": len(text)}


@router.post("/save", response_model=KnowledgeNote, status_code=201)
async def save_lecture_as_note(
    payload: GenerateNoteFromLectureRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    """把整堂课的累积转写蒸馏为一份复习笔记 (LLM 提取知识点)。

    后台异步做 embed 索引;前端可用 chunk_status 轮询直到 'ready'。
    """
    row = await notes_service.generate_note_from_transcript(
        owner_id=user.id,
        transcript=payload.transcript,
        title_hint=payload.title_hint,
        agent_key=payload.agent_key,
        focus_hint=payload.focus_hint,
        parent_id=payload.parent_id,
        tags_override=payload.tags,
        keep_raw_transcript=payload.keep_raw_transcript,
    )
    background_tasks.add_task(notes_indexer.process_note, row["id"])
    return _to_note(row)
