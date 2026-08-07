"""动态学习规划 / 科技树 Pydantic schema。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

RoadmapStatus = Literal["draft", "active", "completed", "archived"]
RoadmapNodeStatus = Literal["done", "current", "open", "locked", "review"]


class RoadmapNode(BaseModel):
    id: str
    title: str
    description: str = ""
    phase: str = ""
    status: RoadmapNodeStatus = "locked"
    estimated_hours: int = Field(default=10, ge=1, le=1000)
    prerequisites: list[str] = Field(default_factory=list)
    mastery_evidence: list[str] = Field(default_factory=list)
    mastery: int = Field(default=0, ge=0, le=100)
    next_action: str = ""


class RoadmapLane(BaseModel):
    id: str
    title: str
    purpose: str = ""
    nodes: list[RoadmapNode] = Field(min_length=1)


class GenerateRoadmapRequest(BaseModel):
    goal: str = Field(min_length=3, max_length=1000)
    baseline: str = Field(default="", max_length=2000)
    weekly_hours: int = Field(default=8, ge=1, le=80)
    target_date: date | None = None
    agent_key: str | None = Field(default=None, max_length=80)
    preferences: str = Field(default="", max_length=1000)


class UpdateRoadmapRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    weekly_hours: int | None = Field(default=None, ge=1, le=80)
    target_date: date | None = None
    agent_key: str | None = Field(default=None, max_length=80)
    status: RoadmapStatus | None = None


class UpdateRoadmapNodeRequest(BaseModel):
    status: RoadmapNodeStatus | None = None
    mastery: int | None = Field(default=None, ge=0, le=100)


class LearningRoadmap(BaseModel):
    id: str
    owner_id: str
    title: str
    goal: str
    baseline: str | None = None
    target_date: date | None = None
    weekly_hours: int
    agent_key: str | None = None
    status: RoadmapStatus
    lanes: list[RoadmapLane]
    version: int = 1
    generated_by_model: str | None = None
    generation_context: dict = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
