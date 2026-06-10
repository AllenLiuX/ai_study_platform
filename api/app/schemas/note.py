"""Phase 5: 笔记 (= 私有知识点) Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

NoteSource = Literal["chat", "manual", "imported"]
ChunkStatus = Literal["pending", "processing", "ready", "failed"]


class KnowledgeNote(BaseModel):
    id: str
    owner_id: str
    agent_key: str | None = None
    origin_session_id: str | None = None
    origin_message_id: str | None = None
    title: str
    content: str
    summary: str | None = None
    tags: list[str] = Field(default_factory=list)
    parent_id: str | None = None
    mastery_score: int = 0
    review_count: int = 0
    last_reviewed_at: datetime | None = None
    source: NoteSource = "chat"
    chunk_status: ChunkStatus = "pending"
    chunk_count: int = 0
    chunk_error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class GenerateNoteFromMessageRequest(BaseModel):
    """从 chat 中某条 assistant 消息生成笔记。"""

    message_id: str  # chat_messages.id
    # 可选父知识点 (放进现有笔记的子节点)
    parent_id: str | None = None
    # 可选 tags 覆盖 (默认让 LLM 给)
    tags: list[str] | None = None


class CreateNoteRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=20000)
    summary: str | None = Field(None, max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=20)
    parent_id: str | None = None
    agent_key: str | None = None
    origin_session_id: str | None = None
    origin_message_id: str | None = None
    source: NoteSource = "manual"


class UpdateNoteRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1, max_length=20000)
    summary: str | None = Field(None, max_length=500)
    tags: list[str] | None = Field(None, max_length=20)
    parent_id: str | None = None
    mastery_score: int | None = Field(None, ge=0, le=100)

    def to_db_fields(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class ReviewNoteRequest(BaseModel):
    """复习时打分。掌握度按指数加权,后端处理。"""

    score: int = Field(..., ge=0, le=100)
