"""学生画像相关 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Grade = Literal["初一", "初二", "初三", "高一", "高二", "高三"]
LearnerType = Literal["k12_student", "free_learner"]


class StudentProfile(BaseModel):
    user_id: str
    name: str | None = None
    grade: Grade | None = None
    school: str | None = None
    textbook_version: str | None = None
    target_exam: str | None = None
    learning_goal: str | None = None
    focus_subjects: list[str] = Field(default_factory=list)
    # Phase 5: 学习者类型 + 自由学习者的关注领域
    learner_type: LearnerType = "k12_student"
    focus_domains: list[str] = Field(default_factory=list)
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
    learner_type: LearnerType | None = None
    focus_domains: list[str] | None = None
    onboarding_completed: bool | None = None


class Subject(BaseModel):
    id: str
    name: str
    stage: str
    description: str | None = None
    sort_order: int = 0


class WeakPoint(BaseModel):
    knowledge_point_id: str
    name: str
    parent_name: str | None = None
    mastery: int
    encounter_count: int = 0


class SubjectProgress(BaseModel):
    subject_id: str
    subject_name: str
    avg_mastery: float = 50.0
    covered_count: int = 0
    weak_count: int = 0
    current_chapter: str | None = None
    weak_points: list[WeakPoint] = Field(default_factory=list)


class DailyTask(BaseModel):
    id: str
    title: str
    description: str
    subject_label: str
    subject_id: str | None = None
    agent_type: str
    estimated_minutes: int = 15
    tag: str
    starter_prompt: str
    knowledge_point_ids: list[str] = Field(default_factory=list)
    roadmap_node_id: str | None = None


class DailyTasksResponse(BaseModel):
    tasks: list[DailyTask] = Field(default_factory=list)
    generated_at: datetime | None = None
    model: str | None = None
    cached: bool = False


class DashboardResponse(BaseModel):
    profile: StudentProfile
    subjects: list[Subject]
    recent_sessions: list[dict] = Field(default_factory=list)
    progress: list[SubjectProgress] = Field(default_factory=list)
    tasks: DailyTasksResponse | None = None
