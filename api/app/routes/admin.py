"""Phase 7.1: 产品后台看板 (admin dashboard).

只有 .env 里 ADMIN_EMAILS 白名单里的邮箱能访问所有 /api/admin/* 接口.
接口设计:
- GET /admin/me         → {is_admin, email}   任何登录用户可调, 用于前端条件展示"后台"入口
- GET /admin/overview   → 关键指标 stat cards
- GET /admin/trend      → 每日新增用户 + 每日消息数 (最近 N 天)
- GET /admin/breakdown  → 分布 (笔记按 source, 资料按类型, 消息按 agent, 群组按公开性)
- GET /admin/users      → 最近注册的 N 个用户 + 每人消息/笔记/资料计数
- GET /admin/top-users  → 最活跃用户 Top N (按消息数)
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from datetime import datetime as _dt

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from ..core.auth import CurrentUser, get_current_user
from ..core.config import get_settings
from ..db.supabase_client import get_admin_client
from ..services import entitlements as ents

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# -----------------------------------------------------------------------------
# 依赖: 判断 / 强制 admin
# -----------------------------------------------------------------------------
def _is_admin(user: CurrentUser) -> bool:
    email = (user.email or "").strip().lower()
    if not email:
        return False
    return email in get_settings().admin_emails_list


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


# -----------------------------------------------------------------------------
# /admin/me — 任何登录用户都能调, 用于前端"是否显示后台入口"
# -----------------------------------------------------------------------------
@router.get("/me")
async def admin_me(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"is_admin": _is_admin(user), "email": user.email}


# -----------------------------------------------------------------------------
# 辅助
# -----------------------------------------------------------------------------
def _count(
    table: str, *, where: dict | None = None, count_column: str = "id"
) -> int:
    client = get_admin_client()
    q = client.table(table).select(count_column, count="exact").limit(1)
    for k, v in (where or {}).items():
        if v is None:
            q = q.is_(k, "null")
        elif isinstance(v, tuple) and v[0] == "gte":
            q = q.gte(k, v[1])
        elif isinstance(v, tuple) and v[0] == "lte":
            q = q.lte(k, v[1])
        else:
            q = q.eq(k, v)
    try:
        resp = q.execute()
        return resp.count or 0
    except Exception as exc:
        logger.warning("count %s failed: %s", table, exc)
        return 0


def _iso(d: datetime) -> str:
    return d.replace(tzinfo=timezone.utc).isoformat() if d.tzinfo is None else d.isoformat()


def _list_auth_users(limit: int = 200) -> list[dict]:
    """列出 auth.users (Admin API), 只取 id/email/created_at/user_metadata."""
    client = get_admin_client()
    out: list[dict] = []
    try:
        # supabase-py Admin API: list_users 支持分页 page/per_page
        page = 1
        while len(out) < limit:
            resp = client.auth.admin.list_users(page=page, per_page=min(200, limit))
            users = getattr(resp, "users", None) or resp or []
            if not users:
                break
            for u in users:
                out.append(
                    {
                        "id": getattr(u, "id", None),
                        "email": getattr(u, "email", None),
                        "created_at": getattr(u, "created_at", None),
                        "user_metadata": getattr(u, "user_metadata", None) or {},
                        "last_sign_in_at": getattr(u, "last_sign_in_at", None),
                    }
                )
                if len(out) >= limit:
                    break
            if len(users) < 200:
                break
            page += 1
    except Exception as exc:
        logger.warning("list auth users failed: %s", exc)
    return out


# -----------------------------------------------------------------------------
# /admin/overview
# -----------------------------------------------------------------------------
@router.get("/overview")
async def overview(_admin: CurrentUser = Depends(require_admin)) -> dict:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    client = get_admin_client()

    # 当前 supabase-py 的 list_users() 直接返回 list[User],没有 total 字段。
    # 分页拉取后计数；MVP 上限 10 万，避免异常配置导致无限请求。
    total_users = len(_list_auth_users(limit=100_000))

    # 活跃用户: 用 chat_messages.role='user' 里 distinct session -> user
    # supabase-py 没有 distinct 直接支持, 拉最近记录去重
    def _active_since(since: datetime) -> int:
        try:
            resp = (
                client.table("chat_messages")
                .select("session_id, created_at")
                .gte("created_at", _iso(since))
                .limit(5000)
                .execute()
            )
            session_ids = list({r["session_id"] for r in (resp.data or []) if r.get("session_id")})
            if not session_ids:
                return 0
            # session_id → student_id (0001 schema 的真实列名)
            s = (
                client.table("chat_sessions")
                .select("student_id")
                .in_("id", session_ids)
                .execute()
            )
            return len(
                {r["student_id"] for r in (s.data or []) if r.get("student_id")}
            )
        except Exception as exc:
            logger.warning("active users query failed: %s", exc)
            return 0

    active_today = _active_since(today_start)
    active_week = _active_since(week_ago)
    active_month = _active_since(month_ago)

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": total_users,
            "active_today": active_today,
            "active_week": active_week,
            "active_month": active_month,
        },
        "content": {
            "chat_messages_total": _count("chat_messages"),
            "chat_messages_today": _count(
                "chat_messages", where={"created_at": ("gte", _iso(today_start))}
            ),
            "chat_sessions_total": _count("chat_sessions"),
            "materials_total": _count("learning_materials"),
            "materials_student_total": _count(
                "learning_materials", where={"owner_type": "student"}
            ),
            "notes_total": _count("knowledge_notes"),
            "practice_sessions_total": _count("practice_sessions"),
            "groups_total": _count("groups"),
            # group_members 是 (group_id,user_id) 复合主键,没有 id 列。
            "group_members_total": _count(
                "group_members", count_column="user_id"
            ),
        },
    }


# -----------------------------------------------------------------------------
# /admin/trend?days=30
# -----------------------------------------------------------------------------
@router.get("/trend")
async def trend(
    days: int = Query(default=30, ge=1, le=90),
    _admin: CurrentUser = Depends(require_admin),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    client = get_admin_client()

    def _by_day(rows: list[dict], date_field: str) -> dict[str, int]:
        c: Counter[str] = Counter()
        for r in rows:
            v = r.get(date_field)
            if not v:
                continue
            try:
                d = v[:10]  # YYYY-MM-DD
                c[d] += 1
            except Exception:
                continue
        return dict(c)

    # 每日消息数
    msg_by_day: dict[str, int] = {}
    try:
        resp = (
            client.table("chat_messages")
            .select("created_at")
            .gte("created_at", _iso(since))
            .limit(20000)
            .execute()
        )
        msg_by_day = _by_day(resp.data or [], "created_at")
    except Exception as exc:
        logger.warning("trend messages failed: %s", exc)

    # 每日新增用户 (auth.users)
    user_by_day: dict[str, int] = {}
    users = _list_auth_users(limit=2000)
    for u in users:
        ts = u.get("created_at")
        if not ts:
            continue
        # created_at 可能是 datetime 对象或 iso string
        if isinstance(ts, datetime):
            d = ts.strftime("%Y-%m-%d")
        else:
            d = str(ts)[:10]
        if str(ts) < _iso(since):
            continue
        user_by_day[d] = user_by_day.get(d, 0) + 1

    # 每日新增笔记 (体现学习活跃度)
    note_by_day: dict[str, int] = {}
    try:
        resp = (
            client.table("knowledge_notes")
            .select("created_at")
            .gte("created_at", _iso(since))
            .limit(20000)
            .execute()
        )
        note_by_day = _by_day(resp.data or [], "created_at")
    except Exception as exc:
        logger.warning("trend notes failed: %s", exc)

    # 填齐每一天 (0 补齐)
    series: list[dict] = []
    for i in range(days, -1, -1):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        series.append(
            {
                "date": d,
                "new_users": user_by_day.get(d, 0),
                "messages": msg_by_day.get(d, 0),
                "notes": note_by_day.get(d, 0),
            }
        )
    return {"days": days, "series": series}


# -----------------------------------------------------------------------------
# /admin/breakdown
# -----------------------------------------------------------------------------
@router.get("/breakdown")
async def breakdown(_admin: CurrentUser = Depends(require_admin)) -> dict:
    client = get_admin_client()

    def _group_count(table: str, field: str, limit: int = 5000) -> list[dict]:
        try:
            resp = client.table(table).select(field).limit(limit).execute()
            c: Counter[str] = Counter()
            for r in resp.data or []:
                v = r.get(field) or "(unknown)"
                c[str(v)] += 1
            return [{"key": k, "count": v} for k, v in c.most_common()]
        except Exception as exc:
            logger.warning("breakdown %s.%s failed: %s", table, field, exc)
            return []

    # 消息按 agent_type (chat_sessions.agent_type)
    msg_by_agent: list[dict] = []
    try:
        resp = (
            client.table("chat_messages")
            .select("session_id, role")
            .eq("role", "assistant")
            .limit(10000)
            .execute()
        )
        msgs = resp.data or []
        sess_ids = list({m["session_id"] for m in msgs if m.get("session_id")})
        if sess_ids:
            s = (
                client.table("chat_sessions")
                .select("id, agent_type")
                .in_("id", sess_ids)
                .execute()
            )
            key_by_sid = {
                r["id"]: (r.get("agent_type") or "(unknown)")
                for r in (s.data or [])
            }
            c: Counter[str] = Counter()
            for m in msgs:
                c[key_by_sid.get(m.get("session_id"), "(unknown)")] += 1
            msg_by_agent = [{"key": k, "count": v} for k, v in c.most_common(10)]
    except Exception as exc:
        logger.warning("breakdown msgs by agent failed: %s", exc)

    return {
        "notes_by_source": _group_count("knowledge_notes", "source"),
        "materials_by_type": _group_count("learning_materials", "material_type"),
        "materials_by_owner_type": _group_count("learning_materials", "owner_type"),
        "messages_by_agent": msg_by_agent,
        "groups_by_visibility": _group_count("groups", "is_public"),
        "practice_by_status": _group_count("practice_sessions", "status"),
    }


# -----------------------------------------------------------------------------
# /admin/users — 最近注册用户列表 + 每人计数
# -----------------------------------------------------------------------------
@router.get("/users")
async def list_users(
    limit: int = Query(default=50, ge=1, le=200),
    _admin: CurrentUser = Depends(require_admin),
) -> dict:
    client = get_admin_client()
    users = _list_auth_users(limit=limit)
    if not users:
        return {"users": []}

    uids = [u["id"] for u in users if u.get("id")]

    # 一次性拿 student_profiles 名字 + grade
    prof_by_uid: dict[str, dict] = {}
    try:
        p = (
            client.table("student_profiles")
            .select("user_id, name, grade, school, learning_goal")
            .in_("user_id", uids)
            .execute()
        )
        prof_by_uid = {r["user_id"]: r for r in (p.data or [])}
    except Exception as exc:
        logger.warning("fetch profiles failed: %s", exc)

    # 消息计数: chat_sessions.student_id → chat_messages.session_id。
    # chat_sessions 没有 owner_id / message_count 列，需从真实消息聚合。
    msg_count_by_uid: dict[str, int] = defaultdict(int)
    try:
        s = (
            client.table("chat_sessions")
            .select("id, student_id")
            .in_("student_id", uids)
            .execute()
        )
        uid_by_session = {
            r["id"]: r["student_id"]
            for r in (s.data or [])
            if r.get("id") and r.get("student_id")
        }
        if uid_by_session:
            m = (
                client.table("chat_messages")
                .select("session_id")
                .in_("session_id", list(uid_by_session))
                .limit(20_000)
                .execute()
            )
            for row in m.data or []:
                uid = uid_by_session.get(row.get("session_id"))
                if uid:
                    msg_count_by_uid[uid] += 1
    except Exception as exc:
        logger.warning("session msg counts failed: %s", exc)

    # 笔记数 / 资料数 (直接 count per user 慢, 一次拉所有 owner_id 再本地聚合)
    def _count_per_user(table: str, owner_field: str = "owner_id") -> dict[str, int]:
        try:
            resp = (
                client.table(table)
                .select(owner_field)
                .in_(owner_field, uids)
                .limit(20000)
                .execute()
            )
            c: Counter[str] = Counter()
            for r in resp.data or []:
                if r.get(owner_field):
                    c[r[owner_field]] += 1
            return dict(c)
        except Exception as exc:
            logger.warning("per-user count %s failed: %s", table, exc)
            return {}

    notes_by_uid = _count_per_user("knowledge_notes")
    mats_by_uid = _count_per_user("learning_materials")

    # Phase 8: 批量取 plan
    plans_by_uid = ents.list_plans_by_user_ids(uids)

    out = []
    for u in users:
        uid = u.get("id")
        prof = prof_by_uid.get(uid) or {}
        meta = u.get("user_metadata") or {}
        p = plans_by_uid.get(uid)
        out.append(
            {
                "user_id": uid,
                "email": u.get("email"),
                "display_name": prof.get("name")
                or meta.get("display_name")
                or meta.get("full_name")
                or meta.get("name"),
                "grade": prof.get("grade"),
                "school": prof.get("school"),
                "learning_goal": prof.get("learning_goal"),
                "plan": p.plan if p else "free",
                "plan_expires_at": (
                    p.expires_at.isoformat() if p and p.expires_at else None
                ),
                "created_at": (
                    u["created_at"].isoformat()
                    if isinstance(u.get("created_at"), datetime)
                    else u.get("created_at")
                ),
                "last_sign_in_at": (
                    u["last_sign_in_at"].isoformat()
                    if isinstance(u.get("last_sign_in_at"), datetime)
                    else u.get("last_sign_in_at")
                ),
                "messages": msg_count_by_uid.get(uid, 0),
                "notes": notes_by_uid.get(uid, 0),
                "materials": mats_by_uid.get(uid, 0),
            }
        )

    return {"users": out}


# -----------------------------------------------------------------------------
# /admin/top-users — 最活跃 Top N (按消息数)
# -----------------------------------------------------------------------------
@router.get("/top-users")
async def top_users(
    limit: int = Query(default=10, ge=1, le=50),
    _admin: CurrentUser = Depends(require_admin),
) -> dict:
    """按最近 30 天真实 chat_messages 数排序."""
    client = get_admin_client()
    since = datetime.now(timezone.utc) - timedelta(days=30)

    try:
        messages_resp = (
            client.table("chat_messages")
            .select("session_id")
            .gte("created_at", _iso(since))
            .limit(20_000)
            .execute()
        )
        message_rows = messages_resp.data or []
        session_ids = list(
            {r["session_id"] for r in message_rows if r.get("session_id")}
        )
        if not session_ids:
            return {"users": []}
        sessions_resp = (
            client.table("chat_sessions")
            .select("id, student_id")
            .in_("id", session_ids)
            .execute()
        )
        uid_by_session = {
            r["id"]: r["student_id"]
            for r in (sessions_resp.data or [])
            if r.get("id") and r.get("student_id")
        }
    except Exception as exc:
        logger.warning("top users query failed: %s", exc)
        return {"users": []}

    agg: dict[str, int] = defaultdict(int)
    for r in message_rows:
        uid = uid_by_session.get(r.get("session_id"))
        if uid:
            agg[uid] += 1

    top = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    if not top:
        return {"users": []}

    uids = [u for u, _ in top]
    # 加名字 / 邮箱
    prof_by_uid: dict[str, Any] = {}
    email_by_uid: dict[str, Any] = {}
    try:
        p = (
            client.table("student_profiles")
            .select("user_id, name, grade")
            .in_("user_id", uids)
            .execute()
        )
        prof_by_uid = {r["user_id"]: r for r in (p.data or [])}
    except Exception:
        pass
    for uid in uids:
        try:
            u = client.auth.admin.get_user_by_id(uid)
            user_obj = getattr(u, "user", None) or u
            email_by_uid[uid] = getattr(user_obj, "email", None)
        except Exception:
            continue

    out = []
    for uid, msgs in top:
        prof = prof_by_uid.get(uid) or {}
        out.append(
            {
                "user_id": uid,
                "email": email_by_uid.get(uid),
                "display_name": prof.get("name"),
                "grade": prof.get("grade"),
                "messages_30d": msgs,
            }
        )
    return {"users": out}


# -----------------------------------------------------------------------------
# POST /admin/users/{uid}/plan — 给指定用户开/关 Pro
# -----------------------------------------------------------------------------
@router.post("/users/{target_user_id}/plan")
async def set_user_plan(
    target_user_id: str,
    body: dict = Body(...),
    admin: CurrentUser = Depends(require_admin),
) -> dict:
    """管理员给指定用户设置 plan.

    body 格式:
      { "plan": "free" | "pro",
        "expires_at": "2026-12-31T23:59:59Z" | null,  # 可选, null 表示永不过期
        "note": "reason" | null }
    """
    plan = str(body.get("plan") or "").strip().lower()
    if plan not in ("free", "pro"):
        raise HTTPException(status_code=400, detail="plan 必须是 'free' 或 'pro'")

    exp_raw = body.get("expires_at")
    expires_at: _dt | None = None
    if exp_raw:
        try:
            expires_at = _dt.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"expires_at 需为 ISO8601, e.g. 2026-12-31T23:59:59Z ({exc})",
            ) from exc

    info = ents.set_plan(
        user_id=target_user_id,
        plan=plan,  # type: ignore[arg-type]
        granted_by=admin.id,
        expires_at=expires_at,
        note=(str(body.get("note")) if body.get("note") else None),
    )
    return {
        "user_id": target_user_id,
        "plan": info.plan,
        "raw_plan": info.raw_plan,
        "expires_at": info.expires_at.isoformat() if info.expires_at else None,
        "granted_at": info.granted_at.isoformat() if info.granted_at else None,
        "note": info.note,
    }
