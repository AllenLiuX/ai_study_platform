"""Phase 8 · Billing / Entitlements (MVP).

统一的 "能不能用 / 还剩多少" 逻辑, 供所有 route 调用.

设计:
- 两档: `free` / `pro`
- 从 `user_plans` 表读; 无行 → `free`. `expires_at` 过期 → 视为 `free`.
- 限额都写在 `PLAN_LIMITS` 里, 一目了然.
- 超限抛 `QuotaExceeded` (HTTP 402 Payment Required), 前端捕获后弹升级提示.
- 用法示例 (在 route 里):

    from ..services import entitlements as ents
    ents.enforce("chat_messages_per_day", user.id)   # 计数 + 判决
    ents.enforce_model_tier(user.id, payload.model_tier)  # 判决

对高频调用 (每次发消息), 我们做 5s 内存缓存避免拖慢.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal

from fastapi import HTTPException, status

from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

Plan = Literal["free", "pro"]

# -----------------------------------------------------------------------------
# 限额配置 — 只改这里就能改产品限额
# -----------------------------------------------------------------------------
# None 表示"不限". 计数类 (per_day) 是滚动 24h 时段, 不是"自然日 00:00 重置".
PLAN_LIMITS: dict[Plan, dict[str, Any]] = {
    "free": {
        # 对话
        "chat_messages_per_day": 30,                # 每 24h 助手回复条数
        "allowed_model_tiers": {"low", "medium"},   # 免费只能用平价档
        # 资料库
        "materials_total": 20,                      # 累计上传数
        # 群组
        "groups_created_total": 0,                  # 免费不能建群
        # 练习
        "practice_sessions_per_day": 5,
        # 练习工坊 (每日 AI 生成定制练习数)
        "practice_studio_per_day": 5,
        # 听课 (每日新建的 lecture 笔记数; knowledge_notes.source='lecture')
        "lecture_notes_per_day": 3,
    },
    "pro": {
        "chat_messages_per_day": None,
        "allowed_model_tiers": {"low", "medium", "high", "extra_high", "max"},
        "materials_total": None,
        "groups_created_total": None,
        "practice_sessions_per_day": None,
        "practice_studio_per_day": None,
        "lecture_notes_per_day": None,
    },
}

# 人类可读的限额描述 (给前端 /me/plan 用)
LIMIT_LABELS: dict[str, str] = {
    "chat_messages_per_day": "每日对话消息",
    "materials_total": "资料库文件总数",
    "groups_created_total": "已创建群组",
    "practice_sessions_per_day": "每日练习会话",
    "practice_studio_per_day": "每日 AI 定制练习",
    "lecture_notes_per_day": "每日听课笔记",
}


# -----------------------------------------------------------------------------
# 数据结构
# -----------------------------------------------------------------------------
@dataclass
class PlanInfo:
    plan: Plan
    expires_at: datetime | None
    granted_by: str | None
    granted_at: datetime | None
    note: str | None
    # 展示用 (以下字段方便直接返给前端)
    is_pro: bool
    expired: bool
    raw_plan: Plan  # DB 里那行的原始 plan, 即使 expired 也保留


class QuotaExceeded(HTTPException):
    """标准 402 Payment Required, 前端识别后弹升级提示."""

    def __init__(self, message: str, key: str, limit: int | None, used: int):
        super().__init__(
            status_code=402,
            detail={
                "message": message,
                "limit_key": key,
                "limit": limit,
                "used": used,
                "upgrade_hint": "升级到 Pro 版可解除限制, 请联系管理员开通.",
            },
        )


# -----------------------------------------------------------------------------
# 缓存 (per-uid, 5s TTL) — 每次发消息都调 DB 太费
# -----------------------------------------------------------------------------
_CACHE_TTL = 5.0
_cache: dict[str, tuple[float, PlanInfo]] = {}


def _now_ts() -> float:
    return time.monotonic()


def _to_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        s = str(v).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _load_plan_row(user_id: str) -> dict | None:
    client = get_admin_client()
    try:
        resp = (
            client.table("user_plans")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("load_plan_row(%s) failed: %s", user_id, exc)
        return None


def get_plan(user_id: str, *, no_cache: bool = False) -> PlanInfo:
    """返回用户当前 plan (考虑过期). 无 DB 行 → free."""
    now = _now_ts()
    if not no_cache:
        hit = _cache.get(user_id)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1]

    row = _load_plan_row(user_id)
    if not row:
        info = PlanInfo(
            plan="free",
            expires_at=None,
            granted_by=None,
            granted_at=None,
            note=None,
            is_pro=False,
            expired=False,
            raw_plan="free",
        )
    else:
        raw_plan: Plan = row.get("plan") or "free"
        exp = _to_dt(row.get("expires_at"))
        expired = bool(exp and exp < datetime.now(timezone.utc))
        effective: Plan = "free" if (raw_plan == "pro" and expired) else raw_plan
        info = PlanInfo(
            plan=effective,
            expires_at=exp,
            granted_by=row.get("granted_by"),
            granted_at=_to_dt(row.get("granted_at")),
            note=row.get("note"),
            is_pro=(effective == "pro"),
            expired=expired,
            raw_plan=raw_plan,
        )
    _cache[user_id] = (now, info)
    return info


def invalidate_plan_cache(user_id: str | None = None) -> None:
    if user_id is None:
        _cache.clear()
    else:
        _cache.pop(user_id, None)


def get_limit(user_id: str, key: str) -> Any:
    plan = get_plan(user_id).plan
    return PLAN_LIMITS.get(plan, {}).get(key)


# -----------------------------------------------------------------------------
# 使用量统计 — 只查最近 24h 或全库累计
# -----------------------------------------------------------------------------
def _count_recent(table: str, filters: Iterable[tuple[str, str, Any]]) -> int:
    """返回 count. filters 是 [(op, field, value), ...], op ∈ eq/gte/lte/in."""
    client = get_admin_client()
    q = client.table(table).select("id", count="exact").limit(1)
    for op, field, val in filters:
        if op == "eq":
            q = q.eq(field, val)
        elif op == "gte":
            q = q.gte(field, val)
        elif op == "lte":
            q = q.lte(field, val)
        elif op == "in":
            q = q.in_(field, list(val))
        else:
            raise ValueError(f"unknown op {op}")
    try:
        r = q.execute()
        return r.count or 0
    except Exception as exc:
        logger.warning("_count_recent %s failed: %s", table, exc)
        return 0


def _day_start_iso() -> str:
    """滚动 24h 起点 (ISO). 用滚动窗口而不是 00:00, 避免时区烦人."""
    return (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()


def _sessions_of(user_id: str) -> list[str]:
    """user_id 名下所有 chat_sessions.id (给消息计数用)."""
    client = get_admin_client()
    try:
        r = (
            client.table("chat_sessions")
            .select("id")
            .eq("student_id", user_id)
            .execute()
        )
        return [x["id"] for x in (r.data or []) if x.get("id")]
    except Exception as exc:
        logger.warning("sessions_of %s failed: %s", user_id, exc)
        return []


def get_usage(user_id: str) -> dict[str, int]:
    """返回所有受限项当前用量 (供 /me/plan + enforce 内部).

    只查真实存在的表; 出错就当 0.
    """
    day_since = _day_start_iso()
    sess_ids = _sessions_of(user_id)

    # 对话消息: 只算 assistant 回复 (发送用户消息本身不消耗额度)
    chat_msgs = 0
    if sess_ids:
        chat_msgs = _count_recent(
            "chat_messages",
            [
                ("in", "session_id", sess_ids),
                ("eq", "role", "assistant"),
                ("gte", "created_at", day_since),
            ],
        )

    return {
        "chat_messages_per_day": chat_msgs,
        "materials_total": _count_recent(
            "learning_materials",
            [("eq", "owner_id", user_id), ("eq", "owner_type", "student")],
        ),
        "groups_created_total": _count_recent(
            "groups",
            [("eq", "owner_id", user_id)],
        ),
        "practice_sessions_per_day": _count_recent(
            "practice_sessions",
            [("eq", "owner_id", user_id), ("gte", "started_at", day_since)],
        ),
        "practice_studio_per_day": _count_recent(
            "practice_specs",
            [("eq", "owner_id", user_id), ("gte", "created_at", day_since)],
        ),
        "lecture_notes_per_day": _count_recent(
            "knowledge_notes",
            [
                ("eq", "owner_id", user_id),
                ("eq", "source", "lecture"),
                ("gte", "created_at", day_since),
            ],
        ),
    }


# -----------------------------------------------------------------------------
# 判决入口
# -----------------------------------------------------------------------------
_HUMAN_MSGS = {
    "chat_messages_per_day": "今日对话次数已用完 (免费 {limit} 次/天)",
    "materials_total": "资料库上传已达上限 ({limit} 个)",
    "groups_created_total": "免费版不能创建群组",
    "practice_sessions_per_day": "今日练习次数已用完 ({limit} 次/天)",
    "practice_studio_per_day": "今日 AI 定制练习次数已用完 ({limit} 次/天)",
    "lecture_notes_per_day": "今日听课笔记数已达上限 ({limit} 次/天)",
}


def enforce(key: str, user_id: str) -> None:
    """检查配额, 超过就抛 402.

    对 per-day 项目只查该项目的当前用量 (轻量); 对总量项目查累计.
    """
    limit = get_limit(user_id, key)
    if limit is None:
        return  # unlimited

    # 走单项查询 (比 get_usage 便宜; 只查一张表)
    day_since = _day_start_iso()
    used = 0
    if key == "chat_messages_per_day":
        sess_ids = _sessions_of(user_id)
        if sess_ids:
            used = _count_recent(
                "chat_messages",
                [
                    ("in", "session_id", sess_ids),
                    ("eq", "role", "assistant"),
                    ("gte", "created_at", day_since),
                ],
            )
    elif key == "materials_total":
        used = _count_recent(
            "learning_materials",
            [("eq", "owner_id", user_id), ("eq", "owner_type", "student")],
        )
    elif key == "groups_created_total":
        used = _count_recent(
            "groups",
            [("eq", "owner_id", user_id)],
        )
    elif key == "practice_sessions_per_day":
        used = _count_recent(
            "practice_sessions",
            [("eq", "owner_id", user_id), ("gte", "started_at", day_since)],
        )
    elif key == "practice_studio_per_day":
        used = _count_recent(
            "practice_specs",
            [("eq", "owner_id", user_id), ("gte", "created_at", day_since)],
        )
    elif key == "lecture_notes_per_day":
        used = _count_recent(
            "knowledge_notes",
            [
                ("eq", "owner_id", user_id),
                ("eq", "source", "lecture"),
                ("gte", "created_at", day_since),
            ],
        )
    else:
        return

    if used >= int(limit):
        msg_tmpl = _HUMAN_MSGS.get(key, "该功能已达免费上限 (limit={limit})")
        raise QuotaExceeded(
            message=msg_tmpl.format(limit=limit),
            key=key,
            limit=int(limit),
            used=int(used),
        )


def enforce_model_tier(user_id: str, tier: str | None) -> None:
    """校验模型档位 (免费只允许 low/medium)."""
    if not tier:
        return
    allowed = get_limit(user_id, "allowed_model_tiers") or set()
    if tier not in allowed:
        raise HTTPException(
            status_code=402,
            detail={
                "message": f"'{tier}' 档模型仅 Pro 用户可用",
                "limit_key": "allowed_model_tiers",
                "limit": sorted(allowed),
                "used": tier,
                "upgrade_hint": "升级到 Pro 版可使用 high / extra_high / max 档模型.",
            },
        )


# -----------------------------------------------------------------------------
# 管理员写入 (给 admin route 用)
# -----------------------------------------------------------------------------
def set_plan(
    *,
    user_id: str,
    plan: Plan,
    granted_by: str,
    expires_at: datetime | None = None,
    note: str | None = None,
) -> PlanInfo:
    if plan not in ("free", "pro"):
        raise ValueError(f"invalid plan: {plan}")
    client = get_admin_client()
    payload = {
        "user_id": user_id,
        "plan": plan,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "granted_by": granted_by,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "note": note,
    }
    try:
        client.table("user_plans").upsert(payload, on_conflict="user_id").execute()
    except Exception as exc:
        logger.exception("set_plan failed")
        raise HTTPException(status_code=500, detail=f"设置 plan 失败: {exc}") from exc
    invalidate_plan_cache(user_id)
    return get_plan(user_id, no_cache=True)


def list_plans_by_user_ids(user_ids: list[str]) -> dict[str, PlanInfo]:
    """批量取 plan (给 admin/users 列表用)."""
    if not user_ids:
        return {}
    client = get_admin_client()
    out: dict[str, PlanInfo] = {}
    try:
        r = (
            client.table("user_plans")
            .select("*")
            .in_("user_id", user_ids)
            .execute()
        )
        rows_by_uid = {row["user_id"]: row for row in (r.data or [])}
    except Exception as exc:
        logger.warning("list_plans_by_user_ids failed: %s", exc)
        rows_by_uid = {}

    for uid in user_ids:
        row = rows_by_uid.get(uid)
        if not row:
            out[uid] = PlanInfo(
                plan="free",
                expires_at=None,
                granted_by=None,
                granted_at=None,
                note=None,
                is_pro=False,
                expired=False,
                raw_plan="free",
            )
        else:
            raw_plan: Plan = row.get("plan") or "free"
            exp = _to_dt(row.get("expires_at"))
            expired = bool(exp and exp < datetime.now(timezone.utc))
            eff: Plan = "free" if (raw_plan == "pro" and expired) else raw_plan
            out[uid] = PlanInfo(
                plan=eff,
                expires_at=exp,
                granted_by=row.get("granted_by"),
                granted_at=_to_dt(row.get("granted_at")),
                note=row.get("note"),
                is_pro=(eff == "pro"),
                expired=expired,
                raw_plan=raw_plan,
            )
    return out
