"""Phase 10 · 练习工坊 (Practice Studio) API：AI 生成 + 保存复用定制练习。"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.practice_studio import (
    GeneratePracticeStudioRequest,
    PlanPracticeStudioRequest,
    PracticeSpecRecord,
    PracticeStudioPlan,
    RefinePracticeStudioRequest,
    UpdatePracticeStudioRequest,
)
from ..services import entitlements as ents
from ..services import practice_studio_service as studio

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/practice-studio", tags=["practice-studio"])


def _to_record(row: dict) -> PracticeSpecRecord:
    return PracticeSpecRecord.model_validate(row)


@router.get("", response_model=list[PracticeSpecRecord])
async def list_specs(
    user: CurrentUser = Depends(get_current_user),
) -> list[PracticeSpecRecord]:
    return [_to_record(row) for row in repos.list_practice_specs(user.id)]


@router.post("/plan", response_model=PracticeStudioPlan)
async def plan_spec(
    payload: PlanPracticeStudioRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeStudioPlan:
    """第一步：分析描述，产出训练器规划(形态+目标+要点+可编辑生成指令)。

    只调用一次 LLM 做轻量规划，不写库、不计入每日额度；用户确认后再走 /generate。
    """
    plan_dict = await studio.plan(payload=payload)
    return PracticeStudioPlan.model_validate(plan_dict)


@router.post("/generate", response_model=PracticeSpecRecord, status_code=201)
async def generate_spec(
    payload: GeneratePracticeStudioRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    ents.enforce("practice_studio_per_day", user.id)
    row = await studio.generate(owner_id=user.id, payload=payload)
    return _to_record(row)


@router.post("/{spec_id}/refine", response_model=PracticeSpecRecord)
async def refine_spec(
    spec_id: str,
    payload: RefinePracticeStudioRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    """生成后用自然语言迭代修改训练器（改界面 / 加功能 / 调难度…），原地更新。"""
    ents.enforce("practice_studio_per_day", user.id)
    row = await studio.refine(owner_id=user.id, spec_id=spec_id, payload=payload)
    return _to_record(row)


@router.get("/public", response_model=list[PracticeSpecRecord])
async def list_public_specs(
    q: str | None = None,
    domain: str | None = None,
    user: CurrentUser = Depends(get_current_user),
) -> list[PracticeSpecRecord]:
    """发现页：其他用户公开分享的训练器。"""
    return [
        _to_record(row) for row in repos.list_public_practice_specs(q=q, domain=domain)
    ]


@router.post("/{source_id}/clone", response_model=PracticeSpecRecord, status_code=201)
async def clone_spec(
    source_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    """把一个公开训练器「收藏到我的工坊」= 克隆一份到自己名下。"""
    row = repos.clone_practice_spec(viewer_id=user.id, source_id=source_id)
    if not row:
        raise HTTPException(status_code=404, detail="训练器不存在或未公开")
    return _to_record(row)


@router.get("/{spec_id}", response_model=PracticeSpecRecord)
async def get_spec(
    spec_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    # 自己的优先；否则允许查看他人公开的训练器
    row = repos.get_practice_spec(spec_id, user.id)
    if not row:
        row = repos.get_public_practice_spec(spec_id)
    if not row:
        raise HTTPException(status_code=404, detail="练习不存在")
    return _to_record(row)


@router.patch("/{spec_id}", response_model=PracticeSpecRecord)
async def update_spec(
    spec_id: str,
    payload: UpdatePracticeStudioRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    current = repos.get_practice_spec(spec_id, user.id)
    if not current:
        raise HTTPException(status_code=404, detail="练习不存在")
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    row = repos.update_practice_spec(spec_id, user.id, fields)
    if not row:
        raise HTTPException(status_code=500, detail="更新练习失败")
    return _to_record(row)


@router.post("/{spec_id}/use", response_model=PracticeSpecRecord)
async def mark_used(
    spec_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    # 自己的训练器：owner 计数
    own = repos.get_practice_spec(spec_id, user.id)
    if own:
        row = repos.update_practice_spec(
            spec_id,
            user.id,
            {
                "times_used": int(own.get("times_used") or 0) + 1,
                "last_used_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return _to_record(row or own)
    # 他人公开训练器：也计一次使用
    pub = repos.get_public_practice_spec(spec_id)
    if not pub:
        raise HTTPException(status_code=404, detail="练习不存在")
    row = repos.bump_practice_spec_usage(spec_id)
    return _to_record(row or pub)


@router.delete("/{spec_id}", status_code=204)
async def delete_spec(
    spec_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    if not repos.delete_practice_spec(spec_id, user.id):
        raise HTTPException(status_code=404, detail="练习不存在")
