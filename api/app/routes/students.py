"""学生画像与 Dashboard 数据。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.student import (
    DailyTasksResponse,
    DashboardResponse,
    StudentProfile,
    StudentProfileUpdate,
    Subject,
    SubjectProgress,
)
from ..services.task_planner import get_or_generate_today_tasks

logger = logging.getLogger(__name__)

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


def _build_subject_progress(user_id: str, subjects: list[dict]) -> list[dict]:
    """对每个学科,汇总 mastery / 薄弱点 / 当前章节。"""
    summary_rows = {row["subject_id"]: row for row in repos.summarize_progress(user_id)}
    progress: list[dict] = []
    for s in subjects:
        sid = s["id"]
        summary = summary_rows.get(sid, {})
        weak = repos.list_weak_points(user_id, sid, limit=3)
        chapter = repos.get_recent_chapter(user_id, sid)
        progress.append(
            {
                "subject_id": sid,
                "subject_name": s["name"],
                "avg_mastery": float(summary.get("avg_mastery") or 50.0),
                "covered_count": int(summary.get("covered_count") or 0),
                "weak_count": int(summary.get("weak_count") or 0),
                "current_chapter": (chapter or {}).get("chapter_name"),
                "weak_points": weak,
            }
        )
    return progress


@router.get("/progress", response_model=list[SubjectProgress])
async def get_progress(
    user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """各学科掌握度汇总 + 薄弱点。"""
    subjects = repos.list_subjects()
    return _build_subject_progress(user.id, subjects)


@router.get("/tasks/today", response_model=DailyTasksResponse)
async def get_today_tasks(
    refresh: bool = Query(False, description="强制重新生成,忽略当天缓存"),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """今日 3 件事:点开即学,基于真实进度生成。"""
    return await get_or_generate_today_tasks(user.id, force_refresh=refresh)


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    profile = _profile_from_row(repos.get_profile(user.id), user)
    subjects = repos.list_subjects()
    recent_sessions = repos.list_sessions(user.id, limit=5)
    progress = _build_subject_progress(user.id, subjects)

    # tasks 嵌入 dashboard 单次拉取,失败不影响主响应
    tasks_payload: dict | None = None
    try:
        tasks_payload = await get_or_generate_today_tasks(user.id, force_refresh=False)
    except Exception as exc:
        logger.warning("dashboard 拉今日任务失败: %s", exc)

    return {
        "profile": profile,
        "subjects": subjects,
        "recent_sessions": recent_sessions,
        "progress": progress,
        "tasks": tasks_payload,
    }
