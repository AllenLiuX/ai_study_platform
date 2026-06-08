"""对话相关 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AgentType = Literal[
    "head_teacher", "math_teacher", "english_teacher", "chinese_teacher"
]


class CreateSessionRequest(BaseModel):
    agent_type: AgentType
    subject_id: str | None = None
    title: str | None = None


class ChatSession(BaseModel):
    id: str
    student_id: str
    agent_type: AgentType
    subject_id: str | None = None
    title: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChatMessage(BaseModel):
    id: str | None = None
    session_id: str
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class SendMessageRequest(BaseModel):
    content: str
