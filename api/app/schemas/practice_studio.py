"""Phase 10 · 练习工坊 (Practice Studio) 的请求 / 响应模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class GeneratePracticeStudioRequest(BaseModel):
    """用自然语言描述想要的练习 / 训练器。

    两步流程：先 /plan 出规划，用户确认/微调后，把规划里的
    generation_prompt 作为 description、连同 template_id/goal/title 传回这里生成。
    """

    description: str = Field(min_length=2, max_length=4000)
    domain: str | None = Field(default=None, max_length=60)
    difficulty: str | None = Field(default=None, max_length=40)
    count: int | None = Field(default=None, ge=1, le=30)
    # 二步流程：确认后的形态与元数据 (可选；不传则 AI 自行决定)
    template_id: str | None = Field(default=None, max_length=40)  # 模板 id / "app" / "auto"
    goal: str | None = Field(default=None, max_length=500)
    title: str | None = Field(default=None, max_length=200)


class PlanPracticeStudioRequest(BaseModel):
    """第一步：用一段描述让 LLM 规划出训练器的形态与配置 (不真正生成内容)。"""

    description: str = Field(min_length=2, max_length=2000)
    domain: str | None = Field(default=None, max_length=60)
    difficulty: str | None = Field(default=None, max_length=40)


class PracticeStudioPlan(BaseModel):
    """训练器规划：给用户确认/微调，再据此真正生成。"""

    title: str
    domain: str
    difficulty: str | None = None
    kind: str  # "template" | "app"
    template_id: str | None = None  # kind=template 时给出具体模板
    template_label: str | None = None  # 中文形态名，前端展示用
    goal: str
    outline: list[str] = Field(default_factory=list)  # 这台训练器会怎么练
    generation_prompt: str  # 交给生成器的详细指令 (可编辑)


class RefinePracticeStudioRequest(BaseModel):
    """生成后用自然语言迭代修改训练器（改界面 / 加功能 / 调难度…）。"""

    instruction: str = Field(min_length=2, max_length=2000)


class UpdatePracticeStudioRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_favorite: bool | None = None
    is_public: bool | None = None


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
    is_public: bool = False
    clone_count: int = 0
    author_name: str | None = None  # 发现页展示作者昵称
    last_used_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
