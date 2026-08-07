"""Phase 10 · 练习工坊 (Practice Studio) API：AI 生成 + 保存复用定制练习。"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.practice_studio import (
    GeneratePracticeStudioRequest,
    PracticeSpecRecord,
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


@router.post("/generate", response_model=PracticeSpecRecord, status_code=201)
async def generate_spec(
    payload: GeneratePracticeStudioRequest,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    ents.enforce("practice_studio_per_day", user.id)
    row = await studio.generate(owner_id=user.id, payload=payload)
    return _to_record(row)


@router.get("/{spec_id}", response_model=PracticeSpecRecord)
async def get_spec(
    spec_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PracticeSpecRecord:
    row = repos.get_practice_spec(spec_id, user.id)
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
    current = repos.get_practice_spec(spec_id, user.id)
    if not current:
        raise HTTPException(status_code=404, detail="练习不存在")
    row = repos.update_practice_spec(
        spec_id,
        user.id,
        {
            "times_used": int(current.get("times_used") or 0) + 1,
            "last_used_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return _to_record(row or current)


@router.delete("/{spec_id}", status_code=204)
async def delete_spec(
    spec_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    if not repos.delete_practice_spec(spec_id, user.id):
        raise HTTPException(status_code=404, detail="练习不存在")
