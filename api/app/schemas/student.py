"""学生画像相关 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Grade = Literal["初一", "初二", "初三", "高一", "高二", "高三"]


class StudentProfile(BaseModel):
    user_id: str
    name: str | None = None
    grade: Grade | None = None
    school: str | None = None
    textbook_version: str | None = None
    target_exam: str | None = None
    learning_goal: str | None = None
    focus_subjects: list[str] = Field(default_factory=list)
    onboarding_completed: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class StudentProfileUpdate(BaseModel):
    name: str | None = None
    grade: Grade | None = None
    school: str | None = None
    textbook_version: str | None = None
    target_exam: str | None = None
    learning_goal: str | None = None
    focus_subjects: list[str] | None = None
    onboarding_completed: bool | None = None


class Subject(BaseModel):
    id: str
    name: str
    stage: str
    description: str | None = None
    sort_order: int = 0


class DashboardResponse(BaseModel):
    profile: StudentProfile
    subjects: list[Subject]
    recent_sessions: list[dict] = Field(default_factory=list)
