"""对话相关 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# Phase 5: agent_type 不再是固定 4 选 1,而是 user_agents.agent_key 的任意值
# (内置老师 / 用户自定义老师 都走同一字段)
AgentType = str


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
    # Phase 1: 引用资料 (RAG)。前端可勾选若干份资料,让 Agent 基于这些资料回答
    # - None: 不主动检索 (默认)
    # - []: 显式不引用,与 None 等价
    # - [id1, id2]: 限定在这些资料中检索 top-k
    material_ids: list[str] | None = None
    # Phase 3.5: 学生可在对话里临时选择模型档位 (low/medium/high/extra_high/max)
    # None = 用 agent 默认 tier (= MEDIUM)
    model_tier: str | None = None
    # Phase 4: 图片附件 (拍照传题)。每项是 chat-attachments bucket 内的 storage_path
    # 形如 "<user_id>/<uuid>.png",后端会拉下来转 base64 inline 给 OpenAI vision
    image_urls: list[str] | None = None


class ChatAttachment(BaseModel):
    """Phase 4: 上传图片的返回体。

    storage_path 用于在 SendMessageRequest.image_urls 中复用。
    """

    storage_path: str
    mime_type: str
    size_bytes: int
    original_filename: str
