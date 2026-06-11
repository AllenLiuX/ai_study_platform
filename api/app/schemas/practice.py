"""Phase 6: 练习模块 Pydantic schemas。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

QuestionKind = Literal["mcq", "multi_mcq", "fill", "short"]
SessionStatus = Literal["active", "finished", "abandoned"]
DifficultyStrategy = Literal[
    "adaptive", "fixed_1", "fixed_2", "fixed_3", "fixed_4", "fixed_5"
]
ModelTierId = Literal["low", "medium", "high", "extra_high", "max"]


class PracticeSession(BaseModel):
    id: str
    owner_id: str
    agent_key: str
    topic: str
    plan: str | None = None
    target_minutes: int = 30
    target_question_count: int = 10
    allowed_kinds: list[QuestionKind] = Field(default_factory=lambda: ["mcq", "fill", "short"])
    difficulty_strategy: DifficultyStrategy = "adaptive"
    model_tier: ModelTierId = "medium"
    status: SessionStatus = "active"
    summary: dict[str, Any] | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # 拼装字段 (server 在 get 时附加,客户端不需要 set)
    question_count: int = 0
    answered_count: int = 0
    correct_count: int = 0


class CreatePracticeSessionRequest(BaseModel):
    agent_key: str = Field(..., min_length=1, max_length=64)
    topic: str = Field(..., min_length=1, max_length=200)
    plan: str | None = Field(None, max_length=4000)
    target_minutes: int = Field(30, ge=5, le=240)
    target_question_count: int = Field(10, ge=1, le=100)
    allowed_kinds: list[QuestionKind] = Field(
        default_factory=lambda: ["mcq", "fill", "short"], min_length=1
    )
    difficulty_strategy: DifficultyStrategy = "adaptive"
    model_tier: ModelTierId = "medium"


class PracticeQuestion(BaseModel):
    id: str
    session_id: str
    idx: int
    kind: QuestionKind
    prompt: str
    options: list[dict[str, Any]] | None = None  # [{id, text}]
    # answer 不直接吐给前端,避免提交前作弊;判题后才会附 reveal
    explanation: str | None = None
    difficulty: int = 3
    knowledge_points: list[str] = Field(default_factory=list)
    source: str = "agent"
    hints: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    # 附加:最近一次作答 (用户已答 / 跳过)
    attempt: "PracticeAttempt | None" = None


class PracticeAttempt(BaseModel):
    id: str
    question_id: str
    user_answer: Any | None = None
    is_correct: bool | None = None
    score: float | None = None
    feedback: str | None = None
    skipped: bool = False
    time_spent_ms: int | None = None
    hints_used: int = 0
    created_at: datetime | None = None


class SubmitAttemptRequest(BaseModel):
    user_answer: Any | None = None  # 不同题型不同形态
    skipped: bool = False
    time_spent_ms: int | None = Field(None, ge=0, le=24 * 3600 * 1000)
    hints_used: int = Field(0, ge=0, le=10)


class AttemptResult(BaseModel):
    """提交答案后返回:对错 + 解析 + 标准答案"""

    attempt: PracticeAttempt
    correct_answer: Any  # 真实答案 (提交后才暴露)
    explanation: str | None = None
    # 关联知识点回顾 (Phase 6.1 可以 ↑掌握度)
    knowledge_points: list[str] = Field(default_factory=list)


class HintRequest(BaseModel):
    hint_level: int = Field(1, ge=1, le=5)  # 第几次提示 (累进)


class HintResponse(BaseModel):
    hint: str
    hint_level: int


class NextQuestionResponse(BaseModel):
    """出下一题的响应:若 session 已满,question=None,提示去 finish。"""

    question: PracticeQuestion | None = None
    is_session_complete: bool = False
    reason: str | None = None  # 例如:已达到 target_question_count


class FinishSessionResponse(BaseModel):
    session: PracticeSession
    # 总结(LLM 生成)+ 知识点表现统计
    summary_markdown: str
    stats: dict[str, Any]


# 让 PracticeQuestion 内部的前向引用解析
PracticeQuestion.model_rebuild()
