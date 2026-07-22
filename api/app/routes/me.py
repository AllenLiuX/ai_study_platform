"""Phase 8 · 当前登录用户的账户/订阅信息.

GET /api/me/plan → 当前 plan + 各项限额 + 当前用量, 前端画进度条 / 弹升级用.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core.auth import CurrentUser, get_current_user
from ..services import entitlements as ents

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/plan")
async def my_plan(user: CurrentUser = Depends(get_current_user)) -> dict:
    info = ents.get_plan(user.id, no_cache=True)
    usage = ents.get_usage(user.id)
    limits = ents.PLAN_LIMITS.get(info.plan, {})

    # 拼一个前端好用的 items 列表 (只包含数值型限额, 不含 allowed_model_tiers)
    items = []
    for key, label in ents.LIMIT_LABELS.items():
        limit = limits.get(key)
        used = int(usage.get(key, 0))
        items.append(
            {
                "key": key,
                "label": label,
                "used": used,
                "limit": limit,  # None = 不限
                "unlimited": limit is None,
                "exhausted": (limit is not None and used >= int(limit)),
                # 滚动窗口 (24h) 还是累计 — 前端展示"今日"或"累计"用
                "period": "day" if key.endswith("_per_day") else "total",
            }
        )

    return {
        "plan": info.plan,
        "is_pro": info.is_pro,
        "expires_at": info.expires_at.isoformat() if info.expires_at else None,
        "expired": info.expired,
        "raw_plan": info.raw_plan,
        "granted_at": info.granted_at.isoformat() if info.granted_at else None,
        "note": info.note,
        "allowed_model_tiers": sorted(limits.get("allowed_model_tiers", set())),
        "usage": items,
    }
