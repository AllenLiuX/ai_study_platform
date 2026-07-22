"""Phase 7: 群组/班级 pydantic schema."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

GroupRole = Literal["owner", "admin", "member"]


class GroupBase(BaseModel):
    id: str
    name: str
    description: str | None = None
    invite_code: str
    is_public: bool
    owner_id: str
    member_count: int
    emoji: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Group(GroupBase):
    """列表 / 搜索返回的最小群组视图。"""


class GroupMember(BaseModel):
    user_id: str
    role: GroupRole
    joined_at: datetime | None = None
    # 可选:后端 join auth.users 时填充 (前端展示昵称 / avatar)
    display_name: str | None = None
    email: str | None = None


class GroupDetail(GroupBase):
    """群详情:含 my_role (调用者在群里的角色) + 前几个成员预览。"""

    my_role: GroupRole
    members_preview: list[GroupMember] = Field(default_factory=list)
    materials_count: int = 0
    notes_count: int = 0


class CreateGroupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    is_public: bool = False
    emoji: str | None = Field(default=None, max_length=8)

    @field_validator("name", "description", "emoji", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None if v == "" else v
        return v


class UpdateGroupRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    is_public: bool | None = None
    emoji: str | None = Field(default=None, max_length=8)


class JoinByCodeRequest(BaseModel):
    invite_code: str = Field(..., min_length=4, max_length=32)
