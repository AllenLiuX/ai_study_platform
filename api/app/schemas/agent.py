"""自定义老师 (Phase 5) Pydantic schema。

字段语义对齐 supabase 表 user_agents。
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

OwnerType = Literal["platform", "user"]

_AGENT_KEY_RE = re.compile(r"^[a-z0-9_\-]{2,64}$")


class UserAgent(BaseModel):
    """API 输出体:展示 owner 可见的所有老师 (含平台 + 自己创建的)。"""

    id: str
    owner_type: OwnerType
    owner_id: str | None = None
    agent_key: str
    display_name: str
    emoji: str | None = "🎓"
    tagline: str | None = None
    role: str | None = None
    system_prompt: str | None = None  # 平台老师可能为空 (用文件 prompt)
    starter_prompts: list[str] = Field(default_factory=list)
    default_material_ids: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    default_model_tier: str = "medium"
    subject_id: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CreateUserAgentRequest(BaseModel):
    """创建私有老师。owner_type 后端固定 'user',owner_id 从 auth 注入。"""

    agent_key: str = Field(
        ...,
        min_length=2,
        max_length=64,
        description="老师唯一标识 (lowercase 字母数字下划线/连字符)",
    )
    display_name: str = Field(..., min_length=1, max_length=64)
    emoji: str | None = "🎓"
    tagline: str | None = Field(None, max_length=200)
    role: str | None = Field(None, max_length=80)
    system_prompt: str = Field(..., min_length=20, max_length=8000)
    starter_prompts: list[str] = Field(default_factory=list, max_length=6)
    default_material_ids: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list, max_length=10)
    default_model_tier: Literal["low", "medium", "high", "extra_high", "max"] = "medium"
    subject_id: str | None = None

    @field_validator("agent_key")
    @classmethod
    def _check_key(cls, v: str) -> str:
        if not _AGENT_KEY_RE.match(v):
            raise ValueError(
                "agent_key 只能包含小写字母/数字/下划线/连字符,长度 2-64"
            )
        # 防止用户撞内置老师 key
        if v in {"head_teacher", "math_teacher", "english_teacher", "chinese_teacher"}:
            raise ValueError("该 agent_key 是平台保留名,请换一个")
        return v


class UpdateUserAgentRequest(BaseModel):
    """更新私有老师。所有字段可选,平台老师不能改。"""

    display_name: str | None = Field(None, min_length=1, max_length=64)
    emoji: str | None = None
    tagline: str | None = Field(None, max_length=200)
    role: str | None = Field(None, max_length=80)
    system_prompt: str | None = Field(None, min_length=20, max_length=8000)
    starter_prompts: list[str] | None = Field(None, max_length=6)
    default_material_ids: list[str] | None = None
    domains: list[str] | None = Field(None, max_length=10)
    default_model_tier: Literal["low", "medium", "high", "extra_high", "max"] | None = None
    subject_id: str | None = None
    is_active: bool | None = None

    def to_db_fields(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in self.model_dump(exclude_unset=True).items():
            out[k] = v
        return out


class GenerateAgentSpecRequest(BaseModel):
    """用一段自然语言描述让 LLM 帮我生成老师的 system_prompt / starter_prompts 等。"""

    description: str = Field(..., min_length=10, max_length=2000)
    domains: list[str] = Field(default_factory=list)


class GeneratedAgentSpec(BaseModel):
    # Phase 5 后续:LLM 直接给一个英文 slug,前端不再客户端转 — 避免中文 display_name
    # 拿不到 ASCII slug 的尴尬
    agent_key: str
    display_name: str
    emoji: str
    tagline: str
    role: str
    system_prompt: str
    starter_prompts: list[str]
    domains: list[str]
    suggested_model_tier: Literal["low", "medium", "high", "extra_high", "max"]
