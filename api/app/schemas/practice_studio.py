"""Phase 10 · 练习工坊 (Practice Studio) 的请求 / 响应模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class GeneratePracticeStudioRequest(BaseModel):
    """用自然语言描述想要的练习。"""

    description: str = Field(min_length=2, max_length=2000)
    domain: str | None = Field(default=None, max_length=60)
    difficulty: str | None = Field(default=None, max_length=40)
    count: int | None = Field(default=None, ge=1, le=30)


class UpdatePracticeStudioRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_favorite: bool | None = None


class PracticeSpecRecord(BaseModel):
    id: str
    owner_id: str
    title: str
    domain: str | None = None
    description: str | None = None
    prompt: str | None = None
    mode: str
    spec: dict[str, Any]
    generated_by_model: str | None = None
    times_used: int = 0
    is_favorite: bool = False
    last_used_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
