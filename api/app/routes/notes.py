"""Phase 5: 笔记 = 私有知识点 CRUD + chat 蒸馏入口。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.note import (
    CreateNoteRequest,
    GenerateNoteFromMessageRequest,
    GenerateNoteFromSessionRequest,
    KnowledgeNote,
    ReviewNoteRequest,
    UpdateNoteRequest,
)
from ..services import notes_indexer, notes_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notes", tags=["notes"])


def _to_note(row: dict) -> KnowledgeNote:
    return KnowledgeNote(
        id=row["id"],
        owner_id=row["owner_id"],
        agent_key=row.get("agent_key"),
        origin_session_id=row.get("origin_session_id"),
        origin_message_id=row.get("origin_message_id"),
        title=row["title"],
        content=row["content"],
        summary=row.get("summary"),
        tags=list(row.get("tags") or []),
        parent_id=row.get("parent_id"),
        mastery_score=int(row.get("mastery_score") or 0),
        review_count=int(row.get("review_count") or 0),
        last_reviewed_at=row.get("last_reviewed_at"),
        source=row.get("source") or "chat",
        chunk_status=row.get("chunk_status") or "pending",
        chunk_count=int(row.get("chunk_count") or 0),
        chunk_error=row.get("chunk_error"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=list[KnowledgeNote])
async def list_notes(
    agent_key: str | None = Query(None),
    tag: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
) -> list[KnowledgeNote]:
    rows = repos.list_notes(user.id, agent_key=agent_key, tag=tag)
    return [_to_note(r) for r in rows]


@router.get("/{note_id}", response_model=KnowledgeNote)
async def get_note(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    row = repos.get_note(note_id, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return _to_note(row)


@router.post("", response_model=KnowledgeNote, status_code=201)
async def create_note(
    payload: CreateNoteRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    row = repos.insert_note(
        {
            "owner_id": user.id,
            "agent_key": payload.agent_key,
            "origin_session_id": payload.origin_session_id,
            "origin_message_id": payload.origin_message_id,
            "title": payload.title,
            "content": payload.content,
            "summary": payload.summary,
            "tags": payload.tags,
            "parent_id": payload.parent_id,
            "source": payload.source,
            "chunk_status": "pending",
        }
    )
    background_tasks.add_task(notes_indexer.process_note, row["id"])
    return _to_note(row)


@router.post("/from_message", response_model=KnowledgeNote, status_code=201)
async def create_note_from_message(
    payload: GenerateNoteFromMessageRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    """从 chat assistant 消息蒸馏一条笔记 (LLM 提取),并异步切片入库。"""
    row = await notes_service.generate_note_from_message(
        owner_id=user.id,
        message_id=payload.message_id,
        parent_id=payload.parent_id,
        tags_override=payload.tags,
    )
    background_tasks.add_task(notes_indexer.process_note, row["id"])
    return _to_note(row)


@router.post("/from_session", response_model=KnowledgeNote, status_code=201)
async def create_note_from_session(
    payload: GenerateNoteFromSessionRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    """把整段对话蒸馏成一份汇总笔记 (整段 transcript + 累计 citations 喂给 LLM)。"""
    row = await notes_service.generate_note_from_session(
        owner_id=user.id,
        session_id=payload.session_id,
        parent_id=payload.parent_id,
        tags_override=payload.tags,
    )
    background_tasks.add_task(notes_indexer.process_note, row["id"])
    return _to_note(row)


@router.patch("/{note_id}", response_model=KnowledgeNote)
async def update_note(
    note_id: str,
    payload: UpdateNoteRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    fields = payload.to_db_fields()
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    # 如果改了正文 / 标题 / 摘要 → 需要 reindex
    needs_reindex = any(k in fields for k in ("content", "title", "summary"))
    if needs_reindex:
        fields["chunk_status"] = "pending"

    row = repos.update_note(note_id, user.id, fields)
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在或无权编辑")

    if needs_reindex:
        background_tasks.add_task(notes_indexer.process_note, note_id)
    return _to_note(row)


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    ok = repos.delete_note(note_id, user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="笔记不存在或无权删除")


@router.post("/{note_id}/review", response_model=KnowledgeNote)
async def review_note(
    note_id: str,
    payload: ReviewNoteRequest,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeNote:
    """复习打分:指数加权 mastery,review_count + 1。"""
    row = repos.get_note(note_id, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")
    old = int(row.get("mastery_score") or 0)
    # 0.4 权重 (新分占 40%,旧分占 60%) — 慢慢爬升,防"刷分"
    new_score = round(old * 0.6 + payload.score * 0.4)
    new_score = max(0, min(100, new_score))
    fields = {
        "mastery_score": new_score,
        "review_count": int(row.get("review_count") or 0) + 1,
        "last_reviewed_at": "now()",  # 让 supabase 走默认时间;若需要可在 RPC 里做
    }
    # supabase-py 不会自动把字符串 'now()' 当函数 — 改用 ISO 当前时间
    from datetime import datetime, timezone

    fields["last_reviewed_at"] = datetime.now(timezone.utc).isoformat()

    out = repos.update_note(note_id, user.id, fields)
    if not out:
        raise HTTPException(status_code=500, detail="更新失败")
    return _to_note(out)
