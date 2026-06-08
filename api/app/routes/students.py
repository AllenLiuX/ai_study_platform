"""学生画像与 Dashboard 数据。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.student import (
    DashboardResponse,
    StudentProfile,
    StudentProfileUpdate,
    Subject,
)

router = APIRouter(prefix="/student", tags=["student"])


def _profile_from_row(row: dict | None, user: CurrentUser) -> dict:
    if row:
        return row
    # 兜底:若注册触发器未跑过(本地直接用 service_role 插入用户的情况),返回最小信息
    return {
        "user_id": user.id,
        "name": user.email.split("@")[0] if user.email else None,
        "onboarding_completed": False,
    }


@router.get("/profile", response_model=StudentProfile)
async def get_profile(user: CurrentUser = Depends(get_current_user)) -> dict:
    row = repos.get_profile(user.id)
    return _profile_from_row(row, user)


@router.patch("/profile", response_model=StudentProfile)
async def update_profile(
    payload: StudentProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    fields = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    return repos.upsert_profile(user.id, fields)


@router.get("/subjects", response_model=list[Subject])
async def list_subjects(
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return repos.list_subjects()


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    profile = _profile_from_row(repos.get_profile(user.id), user)
    subjects = repos.list_subjects()
    recent_sessions = repos.list_sessions(user.id, limit=5)
    return {
        "profile": profile,
        "subjects": subjects,
        "recent_sessions": recent_sessions,
    }
