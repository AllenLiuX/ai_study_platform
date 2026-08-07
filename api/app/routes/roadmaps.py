"""动态学习规划 / 科技树 API。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError as OpenAIAPIError

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.roadmap import (
    GenerateRoadmapRequest,
    LearningRoadmap,
    UpdateRoadmapNodeRequest,
    UpdateRoadmapRequest,
)
from ..services.roadmap_service import generate_roadmap

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/roadmaps", tags=["roadmaps"])


def _to_roadmap(row: dict) -> LearningRoadmap:
    return LearningRoadmap.model_validate(row)


def _agent_for_user(agent_key: str | None, user_id: str) -> dict | None:
    if not agent_key:
        return None
    agent = repos.get_user_agent_by_key(agent_key, owner_id=user_id)
    if not agent or not agent.get("is_active", True):
        raise HTTPException(status_code=404, detail="选择的老师不存在或不可用")
    return agent


@router.get("", response_model=list[LearningRoadmap])
async def list_roadmaps(
    user: CurrentUser = Depends(get_current_user),
) -> list[LearningRoadmap]:
    return [_to_roadmap(row) for row in repos.list_learning_roadmaps(user.id)]


@router.get("/{roadmap_id}", response_model=LearningRoadmap)
async def get_roadmap(
    roadmap_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> LearningRoadmap:
    row = repos.get_learning_roadmap(roadmap_id, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="学习规划不存在")
    return _to_roadmap(row)


@router.post("/generate", response_model=LearningRoadmap, status_code=201)
async def create_generated_roadmap(
    payload: GenerateRoadmapRequest,
    user: CurrentUser = Depends(get_current_user),
) -> LearningRoadmap:
    agent = _agent_for_user(payload.agent_key, user.id)
    agent_context = ""
    if agent:
        domains = "、".join(str(x) for x in (agent.get("domains") or []))
        agent_context = "；".join(
            part
            for part in [
                str(agent.get("display_name") or ""),
                str(agent.get("role") or agent.get("tagline") or ""),
                f"擅长领域：{domains}" if domains else "",
            ]
            if part
        )

    try:
        title, lanes, model = await generate_roadmap(
            payload,
            agent_context=agent_context,
        )
    except OpenAIAPIError as exc:
        logger.warning("roadmap generation failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"规划生成失败: {exc}") from exc
    except (ValueError, TypeError) as exc:
        logger.warning("invalid roadmap generation: %s", exc)
        raise HTTPException(status_code=502, detail="规划结构异常，请重试") from exc

    row = repos.create_learning_roadmap(
        user.id,
        {
            "title": title,
            "goal": payload.goal,
            "baseline": payload.baseline or None,
            "target_date": payload.target_date.isoformat() if payload.target_date else None,
            "weekly_hours": payload.weekly_hours,
            "agent_key": payload.agent_key,
            "status": "active",
            "lanes": [lane.model_dump(mode="json") for lane in lanes],
            "generated_by_model": model,
            "generation_context": {
                "preferences": payload.preferences,
                "agent_display_name": agent.get("display_name") if agent else None,
            },
        },
    )
    return _to_roadmap(row)


@router.patch("/{roadmap_id}", response_model=LearningRoadmap)
async def update_roadmap(
    roadmap_id: str,
    payload: UpdateRoadmapRequest,
    user: CurrentUser = Depends(get_current_user),
) -> LearningRoadmap:
    current = repos.get_learning_roadmap(roadmap_id, user.id)
    if not current:
        raise HTTPException(status_code=404, detail="学习规划不存在")

    fields = payload.model_dump(exclude_unset=True, mode="json")
    if "agent_key" in fields and fields["agent_key"]:
        _agent_for_user(fields["agent_key"], user.id)
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    row = repos.update_learning_roadmap(roadmap_id, user.id, fields)
    if not row:
        raise HTTPException(status_code=500, detail="更新学习规划失败")
    return _to_roadmap(row)


@router.patch("/{roadmap_id}/nodes/{node_id}", response_model=LearningRoadmap)
async def update_roadmap_node(
    roadmap_id: str,
    node_id: str,
    payload: UpdateRoadmapNodeRequest,
    user: CurrentUser = Depends(get_current_user),
) -> LearningRoadmap:
    current = repos.get_learning_roadmap(roadmap_id, user.id)
    if not current:
        raise HTTPException(status_code=404, detail="学习规划不存在")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    lanes = current.get("lanes") or []
    found = False
    for lane in lanes:
        for node in lane.get("nodes") or []:
            if node.get("id") == node_id:
                node.update(changes)
                found = True
                break
        if found:
            break
    if not found:
        raise HTTPException(status_code=404, detail="学习节点不存在")

    row = repos.update_learning_roadmap(
        roadmap_id,
        user.id,
        {"lanes": lanes, "version": int(current.get("version") or 1) + 1},
    )
    if not row:
        raise HTTPException(status_code=500, detail="更新学习节点失败")
    return _to_roadmap(row)
