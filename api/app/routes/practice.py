"""Phase 6: 练习模块 API。

端点:
  POST   /practice/sessions                       创建一次练习 (LLM 生成 plan)
  GET    /practice/sessions                       列出我的练习
  GET    /practice/sessions/{id}                  获取练习详情 (含统计)
  GET    /practice/sessions/{id}/questions        获取所有题 + 我的作答 (复盘 / 续答用)
  POST   /practice/sessions/{id}/next             出下一题
  POST   /practice/sessions/{id}/finish           结束并生成总结
  DELETE /practice/sessions/{id}                  删除练习
  POST   /practice/questions/{id}/attempt         提交答案 (判题 / LLM 评分)
  POST   /practice/questions/{id}/hint            申请提示
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.practice import (
    AttemptResult,
    CreatePracticeSessionRequest,
    FinishSessionResponse,
    HintRequest,
    HintResponse,
    NextQuestionResponse,
    PracticeAttempt,
    PracticeQuestion,
    PracticeSession,
    SubmitAttemptRequest,
)
from ..services import practice_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/practice", tags=["practice"])


# -----------------------------------------------------------------------------
# Sessions
# -----------------------------------------------------------------------------


@router.post("/sessions", response_model=PracticeSession)
async def create_session(
    payload: CreatePracticeSessionRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSession:
    session = await practice_service.create_session(
        owner_id=user.id, payload=payload.model_dump()
    )
    return PracticeSession.model_validate(practice_service.session_view(session))


@router.get("/sessions", response_model=list[PracticeSession])
def list_sessions(
    status: str | None = None,
    limit: int = 30,
    user: CurrentUser = Depends(get_current_user),
) -> list[PracticeSession]:
    rows = repos.list_practice_sessions(user.id, status=status, limit=limit)
    return [PracticeSession.model_validate(practice_service.session_view(r)) for r in rows]


@router.get("/sessions/{session_id}", response_model=PracticeSession)
def get_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSession:
    row = repos.get_practice_session(session_id, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="练习不存在")
    return PracticeSession.model_validate(practice_service.session_view(row))


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    ok = repos.delete_practice_session(session_id, user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="练习不存在或已删除")
    return {"deleted": True}


@router.get("/sessions/{session_id}/questions", response_model=list[PracticeQuestion])
def list_session_questions(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[PracticeQuestion]:
    rows = practice_service.session_questions_view(user.id, session_id)
    return [PracticeQuestion.model_validate(r) for r in rows]


@router.post("/sessions/{session_id}/next", response_model=NextQuestionResponse)
async def next_question(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> NextQuestionResponse:
    try:
        q = await practice_service.get_or_create_next_question(
            owner_id=user.id, session_id=session_id
        )
    except HTTPException as exc:
        if exc.status_code == 409 and isinstance(exc.detail, dict) and exc.detail.get("complete"):
            return NextQuestionResponse(
                question=None,
                is_session_complete=True,
                reason=str(exc.detail.get("reason") or "练习已完成"),
            )
        raise
    return NextQuestionResponse(question=PracticeQuestion.model_validate(q))


@router.post("/sessions/{session_id}/finish", response_model=FinishSessionResponse)
async def finish_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> FinishSessionResponse:
    out = await practice_service.finish_session(owner_id=user.id, session_id=session_id)
    return FinishSessionResponse(
        session=PracticeSession.model_validate(
            practice_service.session_view(out["session"])
        ),
        summary_markdown=out["summary_markdown"],
        stats=out["stats"],
    )


# -----------------------------------------------------------------------------
# Questions / Attempts / Hints
# -----------------------------------------------------------------------------


@router.post("/questions/{question_id}/attempt", response_model=AttemptResult)
async def submit_attempt(
    question_id: str,
    payload: SubmitAttemptRequest,
    user: CurrentUser = Depends(get_current_user),
) -> AttemptResult:
    out = await practice_service.submit_attempt(
        owner_id=user.id,
        question_id=question_id,
        user_answer=payload.user_answer,
        skipped=payload.skipped,
        time_spent_ms=payload.time_spent_ms,
        hints_used=payload.hints_used,
    )
    return AttemptResult(
        attempt=PracticeAttempt.model_validate(out["attempt"]),
        correct_answer=out["correct_answer"],
        explanation=out.get("explanation"),
        knowledge_points=out.get("knowledge_points") or [],
    )


@router.post("/questions/{question_id}/hint", response_model=HintResponse)
async def request_hint(
    question_id: str,
    payload: HintRequest,
    user: CurrentUser = Depends(get_current_user),
) -> HintResponse:
    out = await practice_service.get_hint(
        owner_id=user.id,
        question_id=question_id,
        hint_level=payload.hint_level,
    )
    return HintResponse.model_validate(out)
