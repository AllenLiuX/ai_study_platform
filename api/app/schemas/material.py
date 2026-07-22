"""学习资料相关的 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ParseStatus = Literal["pending", "processing", "ready", "failed"]
MaterialType = Literal[
    "textbook", "handout", "homework", "exam", "note", "wrong_question", "other"
]


class Material(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_type: Literal["platform", "student"]
    owner_id: str | None
    title: str
    subject_id: str | None
    grade: str | None
    material_type: MaterialType
    original_filename: str
    mime_type: str
    size_bytes: int
    parse_status: ParseStatus
    parse_error: str | None = None
    summary: str | None = None
    chunk_count: int
    # Phase 7: 群共享标记
    group_id: str | None = None
    created_at: datetime
    updated_at: datetime


class MaterialCreateForm(BaseModel):
    """multipart 上传时,文件外的字段。"""

    title: str | None = None
    subject_id: str | None = None
    grade: str | None = None
    material_type: MaterialType = "note"


class Citation(BaseModel):
    """assistant 消息里展示给学生的引用条目。"""

    material_id: str
    material_title: str
    chunk_index: int
    similarity: float = Field(..., ge=-1.0, le=1.0)
    snippet: str
