"""数据库操作封装。Phase 0 涵盖学生画像、会话、消息。"""

from __future__ import annotations

from typing import Any

from .supabase_client import get_admin_client


# -----------------------------------------------------------------------------
# Student Profile
# -----------------------------------------------------------------------------
def get_profile(user_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("student_profiles")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def upsert_profile(user_id: str, fields: dict[str, Any]) -> dict:
    client = get_admin_client()
    payload = {"user_id": user_id, **fields}
    resp = (
        client.table("student_profiles")
        .upsert(payload, on_conflict="user_id")
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else payload


# -----------------------------------------------------------------------------
# Subjects
# -----------------------------------------------------------------------------
def list_subjects() -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("subjects")
        .select("*")
        .order("sort_order", desc=False)
        .execute()
    )
    return resp.data or []


# -----------------------------------------------------------------------------
# Chat Sessions
# -----------------------------------------------------------------------------
def create_session(
    *, student_id: str, agent_type: str, subject_id: str | None, title: str | None
) -> dict:
    client = get_admin_client()
    payload = {
        "student_id": student_id,
        "agent_type": agent_type,
        "subject_id": subject_id,
        "title": title,
    }
    resp = client.table("chat_sessions").insert(payload).execute()
    return (resp.data or [payload])[0]


def get_session(session_id: str, student_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("chat_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("student_id", student_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_sessions(student_id: str, limit: int = 50) -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("chat_sessions")
        .select("*")
        .eq("student_id", student_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


def delete_session(session_id: str, student_id: str) -> bool:
    """删除 session (附带 messages,通过 FK ON DELETE CASCADE)。

    返回 True 表示删了 (传入 session 属当前 user);False 表示该 session
    不存在 / 不归属当前 user — 此时不报错,但调用方应当返回 404。
    """
    client = get_admin_client()
    resp = (
        client.table("chat_sessions")
        .delete()
        .eq("id", session_id)
        .eq("student_id", student_id)
        .execute()
    )
    return bool(resp.data)


def touch_session(session_id: str, *, title: str | None = None) -> None:
    """更新 session 的 updated_at,可选更新 title。"""
    client = get_admin_client()
    payload: dict[str, Any] = {}
    if title is not None:
        payload["title"] = title
    if not payload:
        # 即便没有字段变化,也要触发 updated_at trigger
        payload["title"] = None
        existing = (
            client.table("chat_sessions")
            .select("title")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        if existing and existing.data and existing.data.get("title"):
            payload["title"] = existing.data["title"]
    client.table("chat_sessions").update(payload).eq("id", session_id).execute()


# -----------------------------------------------------------------------------
# Chat Messages
# -----------------------------------------------------------------------------
def list_messages(session_id: str) -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("chat_messages")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=False)
        .execute()
    )
    return resp.data or []


def insert_message(
    *,
    session_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> dict:
    client = get_admin_client()
    payload = {
        "session_id": session_id,
        "role": role,
        "content": content,
        "metadata": metadata or {},
    }
    resp = client.table("chat_messages").insert(payload).execute()
    return (resp.data or [payload])[0]


# -----------------------------------------------------------------------------
# Learning Materials & Chunks (Phase 1)
# -----------------------------------------------------------------------------
def insert_material(payload: dict[str, Any]) -> dict:
    """新建一条 learning_materials,通常 parse_status='pending'。"""
    client = get_admin_client()
    resp = client.table("learning_materials").insert(payload).execute()
    return (resp.data or [payload])[0]


def update_material(material_id: str, fields: dict[str, Any]) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .update(fields)
        .eq("id", material_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def get_material(material_id: str, owner_id: str) -> dict | None:
    """学生权限下读单条 (确保归属本人或平台公共)。"""
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .select("*")
        .eq("id", material_id)
        .or_(f"owner_id.eq.{owner_id},owner_type.eq.platform")
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def get_material_by_id(material_id: str) -> dict | None:
    """后端内部用,不做归属过滤。"""
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .select("*")
        .eq("id", material_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_materials(
    owner_id: str,
    *,
    scope: str = "personal",  # 'personal' | 'group' | 'all'
    group_id: str | None = None,
    group_ids: list[str] | None = None,
    limit: int = 100,
) -> list[dict]:
    """学生维度的资料列表。

    scope 语义 (Phase 7):
      - 'personal': owner_id 匹配 且 group_id IS NULL, 加上平台公共
      - 'group': 指定 group_id (需在 group_ids 里, 后端已鉴权) 的所有资料
      - 'all': 个人 (含平台) + 我加入的所有群 (group_ids) 的资料
    """
    client = get_admin_client()
    q = client.table("learning_materials").select("*")

    if scope == "group":
        if not group_id:
            return []
        q = q.eq("group_id", group_id)
    elif scope == "all":
        # 个人 (owner + null group) / 平台 / 我加入的群
        gids = group_ids or []
        # supabase-py 的 .or_ 支持逗号分隔多条件
        conds = [f"owner_id.eq.{owner_id}", "owner_type.eq.platform"]
        if gids:
            # in.(a,b) 语法
            conds.append(f"group_id.in.({','.join(gids)})")
        q = q.or_(",".join(conds))
    else:  # personal (默认)
        # owner_id 是自己 且 group_id IS NULL, 或 平台公共
        # supabase-py .or_ 里 is.null 用 is.null 写法
        q = q.or_(
            f"and(owner_id.eq.{owner_id},group_id.is.null),owner_type.eq.platform"
        )

    resp = q.order("created_at", desc=True).limit(limit).execute()
    return resp.data or []


def delete_material(material_id: str, owner_id: str) -> bool:
    """仅允许删自己上传的;chunks 会随 ON DELETE CASCADE 一起删。"""
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .delete()
        .eq("id", material_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    return bool(resp.data)


def insert_material_chunks(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    client = get_admin_client()
    # supabase-py 的 insert 上限大约几百行,实践中一份资料 chunk 数远低于这个,直接一次性插
    client.table("material_chunks").insert(rows).execute()


def delete_material_chunks(material_id: str) -> None:
    """重处理时清掉旧 chunk。"""
    client = get_admin_client()
    client.table("material_chunks").delete().eq("material_id", material_id).execute()


def count_material_chunks(material_id: str) -> int:
    client = get_admin_client()
    resp = (
        client.table("material_chunks")
        .select("id", count="exact")
        .eq("material_id", material_id)
        .execute()
    )
    return resp.count or 0


# -----------------------------------------------------------------------------
# Knowledge Points & Progress (Phase 2)
# -----------------------------------------------------------------------------
def summarize_progress(user_id: str) -> list[dict]:
    """每个学科:avg_mastery / covered_count / weak_count。"""
    client = get_admin_client()
    resp = client.rpc(
        "summarize_student_progress", {"p_student_id": user_id}
    ).execute()
    return resp.data or []


def list_weak_points(user_id: str, subject_id: str, limit: int = 3) -> list[dict]:
    """某学科薄弱点 top-N。"""
    client = get_admin_client()
    resp = client.rpc(
        "list_weak_points",
        {"p_student_id": user_id, "p_subject_id": subject_id, "p_limit": limit},
    ).execute()
    return resp.data or []


def get_recent_chapter(user_id: str, subject_id: str) -> dict | None:
    """学生在某学科最近接触最多的章节。"""
    client = get_admin_client()
    resp = client.rpc(
        "recent_chapter", {"p_student_id": user_id, "p_subject_id": subject_id}
    ).execute()
    rows = resp.data or []
    return rows[0] if rows else None


# -----------------------------------------------------------------------------
# User Agents (Phase 5) - 自定义老师
# -----------------------------------------------------------------------------
def list_user_agents(owner_id: str) -> list[dict]:
    """读 owner 可见的所有老师 (平台 + 私有),按更新时间倒序。"""
    client = get_admin_client()
    resp = (
        client.table("user_agents")
        .select("*")
        .or_(f"owner_type.eq.platform,owner_id.eq.{owner_id}")
        .eq("is_active", True)
        .order("owner_type", desc=False)  # platform 在前
        .order("created_at", desc=False)
        .execute()
    )
    return resp.data or []


def get_user_agent_by_key(agent_key: str, owner_id: str | None = None) -> dict | None:
    """按 agent_key 查老师 (主键唯一)。owner_id 传入时做归属检查,None 时不做。"""
    client = get_admin_client()
    q = client.table("user_agents").select("*").eq("agent_key", agent_key)
    resp = q.maybe_single().execute()
    row = resp.data if resp else None
    if row and owner_id is not None:
        if row["owner_type"] == "platform":
            return row
        if row["owner_type"] == "user" and row.get("owner_id") == owner_id:
            return row
        return None
    return row


def create_user_agent(*, owner_id: str, payload: dict) -> dict:
    """创建私有老师 (owner_type 固定 user,owner_id 后端注入)。"""
    client = get_admin_client()
    row = {
        **payload,
        "owner_type": "user",
        "owner_id": owner_id,
    }
    resp = client.table("user_agents").insert(row).execute()
    return (resp.data or [row])[0]


def update_user_agent(
    *, agent_key: str, owner_id: str, fields: dict
) -> dict | None:
    """更新私有老师 (平台老师禁止编辑)。"""
    client = get_admin_client()
    resp = (
        client.table("user_agents")
        .update(fields)
        .eq("agent_key", agent_key)
        .eq("owner_type", "user")
        .eq("owner_id", owner_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def delete_user_agent(*, agent_key: str, owner_id: str) -> bool:
    """删除私有老师 (软删 — 标记 is_active=false,保留 chat_sessions 历史可读)。"""
    client = get_admin_client()
    resp = (
        client.table("user_agents")
        .update({"is_active": False})
        .eq("agent_key", agent_key)
        .eq("owner_type", "user")
        .eq("owner_id", owner_id)
        .execute()
    )
    return bool(resp.data)


# -----------------------------------------------------------------------------
# Knowledge Notes (Phase 5) - 笔记 = 私有知识点
# -----------------------------------------------------------------------------
def list_notes(
    owner_id: str,
    *,
    agent_key: str | None = None,
    tag: str | None = None,
    scope: str = "personal",  # 'personal' | 'group' | 'all'
    group_id: str | None = None,
    group_ids: list[str] | None = None,
    limit: int = 200,
) -> list[dict]:
    """笔记列表。Phase 7 起 scope 语义同 list_materials。"""
    client = get_admin_client()
    q = client.table("knowledge_notes").select("*")

    if scope == "group":
        if not group_id:
            return []
        q = q.eq("group_id", group_id)
    elif scope == "all":
        gids = group_ids or []
        conds = [f"owner_id.eq.{owner_id}"]
        if gids:
            conds.append(f"group_id.in.({','.join(gids)})")
        q = q.or_(",".join(conds))
    else:  # personal
        q = q.eq("owner_id", owner_id).is_("group_id", "null")

    if agent_key:
        q = q.eq("agent_key", agent_key)
    if tag:
        q = q.contains("tags", [tag])
    resp = q.order("updated_at", desc=True).limit(limit).execute()
    return resp.data or []


def get_note(note_id: str, owner_id: str) -> dict | None:
    """读单条笔记 — 只匹配 owner (不含群共享;群内读走 get_note_admin)。"""
    client = get_admin_client()
    resp = (
        client.table("knowledge_notes")
        .select("*")
        .eq("id", note_id)
        .eq("owner_id", owner_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def get_note_by_id(note_id: str) -> dict | None:
    """后端内部用 (不做归属过滤;权限交调用方)。"""
    client = get_admin_client()
    resp = (
        client.table("knowledge_notes")
        .select("*")
        .eq("id", note_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def insert_note(payload: dict) -> dict:
    client = get_admin_client()
    resp = client.table("knowledge_notes").insert(payload).execute()
    return (resp.data or [payload])[0]


def update_note(note_id: str, owner_id: str, fields: dict) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("knowledge_notes")
        .update(fields)
        .eq("id", note_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def delete_note(note_id: str, owner_id: str) -> bool:
    client = get_admin_client()
    resp = (
        client.table("knowledge_notes")
        .delete()
        .eq("id", note_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    return bool(resp.data)


def insert_note_chunks(rows: list[dict]) -> None:
    if not rows:
        return
    client = get_admin_client()
    client.table("knowledge_note_chunks").insert(rows).execute()


def delete_note_chunks(note_id: str) -> None:
    client = get_admin_client()
    client.table("knowledge_note_chunks").delete().eq("note_id", note_id).execute()


# =============================================================================
# Phase 6: 练习模块
# =============================================================================


def create_practice_session(owner_id: str, fields: dict[str, Any]) -> dict:
    client = get_admin_client()
    payload = {"owner_id": owner_id, **fields}
    resp = client.table("practice_sessions").insert(payload).execute()
    return (resp.data or [payload])[0]


def get_practice_session(session_id: str, owner_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("practice_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("owner_id", owner_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_practice_sessions(
    owner_id: str,
    *,
    status: str | None = None,
    limit: int = 30,
) -> list[dict]:
    client = get_admin_client()
    q = (
        client.table("practice_sessions")
        .select("*")
        .eq("owner_id", owner_id)
        .order("started_at", desc=True)
        .limit(limit)
    )
    if status:
        q = q.eq("status", status)
    resp = q.execute()
    return resp.data or []


def update_practice_session(
    session_id: str, owner_id: str, fields: dict[str, Any]
) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("practice_sessions")
        .update(fields)
        .eq("id", session_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def delete_practice_session(session_id: str, owner_id: str) -> bool:
    client = get_admin_client()
    resp = (
        client.table("practice_sessions")
        .delete()
        .eq("id", session_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    return bool(resp.data)


def insert_practice_question(fields: dict[str, Any]) -> dict:
    client = get_admin_client()
    resp = client.table("practice_questions").insert(fields).execute()
    return (resp.data or [fields])[0]


def get_practice_question(question_id: str) -> dict | None:
    """注意:不做 owner 校验,调用方需要先校验 session 归属。"""
    client = get_admin_client()
    resp = (
        client.table("practice_questions")
        .select("*")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_practice_questions(session_id: str) -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("practice_questions")
        .select("*")
        .eq("session_id", session_id)
        .order("idx", desc=False)
        .execute()
    )
    return resp.data or []


def insert_practice_attempt(fields: dict[str, Any]) -> dict:
    client = get_admin_client()
    resp = client.table("practice_attempts").insert(fields).execute()
    return (resp.data or [fields])[0]


def list_practice_attempts(question_ids: list[str]) -> list[dict]:
    if not question_ids:
        return []
    client = get_admin_client()
    resp = (
        client.table("practice_attempts")
        .select("*")
        .in_("question_id", question_ids)
        .order("created_at", desc=False)
        .execute()
    )
    return resp.data or []


# =============================================================================
# Phase 7: 群组 / 班级 (共享资料库 + 笔记)
# =============================================================================
import secrets
import string


_INVITE_ALPHABET = string.ascii_uppercase + string.digits  # 大写+数字, 好念不易混
# 排除易混字符
_INVITE_ALPHABET = _INVITE_ALPHABET.translate(str.maketrans("", "", "O0I1"))


def generate_invite_code(length: int = 8, *, max_attempts: int = 8) -> str:
    """生成一个全局唯一的邀请码 (最多重试 max_attempts 次防碰撞)。"""
    client = get_admin_client()
    for _ in range(max_attempts):
        code = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(length))
        resp = (
            client.table("groups")
            .select("id", count="exact")
            .eq("invite_code", code)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return code
    # 极小概率碰撞, 加长再试一次
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(length + 2))


def create_group(*, owner_id: str, payload: dict) -> dict:
    """建群 + 把 owner 写进 group_members(role='owner') 一步到位。"""
    client = get_admin_client()
    row = {
        **payload,
        "owner_id": owner_id,
        "invite_code": payload.get("invite_code") or generate_invite_code(),
        "member_count": 1,
    }
    resp = client.table("groups").insert(row).execute()
    group = (resp.data or [row])[0]
    # 加 owner 到 members (trigger 会自动把 member_count 从 1 变 2? 不会 — 我们初始化是 1
    # 且 trigger 走 +1, 所以先把 member_count 落成 0 再让 trigger 加到 1)
    # 修正: 上面 create 里已经写 member_count=1 相当于把 owner 计进去,
    #       insert group_members 时 trigger 会再 +1 → 2, 错. 先把 groups 落成 0.
    client.table("groups").update({"member_count": 0}).eq("id", group["id"]).execute()
    client.table("group_members").insert(
        {"group_id": group["id"], "user_id": owner_id, "role": "owner"}
    ).execute()
    # 再读一次拿最新 member_count
    group = get_group_by_id(group["id"]) or group
    return group


def get_group_by_id(group_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("groups")
        .select("*")
        .eq("id", group_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def get_group_by_invite_code(code: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("groups")
        .select("*")
        .eq("invite_code", code)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_my_groups(user_id: str, limit: int = 50) -> list[dict]:
    """我加入的所有群 (含 owner)。"""
    client = get_admin_client()
    # 先取 group_ids
    m = (
        client.table("group_members")
        .select("group_id, role, joined_at")
        .eq("user_id", user_id)
        .order("joined_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = m.data or []
    if not rows:
        return []
    role_by_gid = {r["group_id"]: r["role"] for r in rows}
    gids = list(role_by_gid.keys())
    g = (
        client.table("groups")
        .select("*")
        .in_("id", gids)
        .execute()
    )
    groups = g.data or []
    # 附上 my_role
    for grp in groups:
        grp["my_role"] = role_by_gid.get(grp["id"], "member")
    # 按 joined_at 降序 (member 表里的顺序)
    order = {gid: i for i, gid in enumerate(gids)}
    groups.sort(key=lambda x: order.get(x["id"], 999))
    return groups


def list_my_group_ids(user_id: str) -> list[str]:
    """快速拿 group_ids 列表, 用于 materials/notes scope='all' 查询。"""
    client = get_admin_client()
    resp = (
        client.table("group_members")
        .select("group_id")
        .eq("user_id", user_id)
        .execute()
    )
    return [r["group_id"] for r in (resp.data or [])]


def search_public_groups(*, q: str | None = None, limit: int = 30) -> list[dict]:
    """搜公开群 (is_public=true), q 走 ilike 模糊匹配 name/description。"""
    client = get_admin_client()
    query = (
        client.table("groups")
        .select("*")
        .eq("is_public", True)
        .order("member_count", desc=True)
        .limit(limit)
    )
    if q:
        q_norm = q.strip().replace(",", " ")[:60]
        if q_norm:
            # ilike 用 % 作通配, or_ 组合 name/description
            like = f"%{q_norm}%"
            query = query.or_(f"name.ilike.{like},description.ilike.{like}")
    resp = query.execute()
    return resp.data or []


def get_group_member(group_id: str, user_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("group_members")
        .select("*")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def list_group_members(group_id: str, limit: int = 100) -> list[dict]:
    """列出群成员, 附上 display_name (student_profiles.name) + email (auth.users.email)."""
    client = get_admin_client()
    resp = (
        client.table("group_members")
        .select("*")
        .eq("group_id", group_id)
        .order("role", desc=False)  # owner/admin/member 字典序不完全对, 前端再排
        .order("joined_at", desc=False)
        .limit(limit)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return rows

    user_ids = [r["user_id"] for r in rows]

    # 补 student_profiles.name
    name_by_uid: dict[str, str | None] = {}
    try:
        p = (
            client.table("student_profiles")
            .select("user_id, name")
            .in_("user_id", user_ids)
            .execute()
        )
        for row in p.data or []:
            name_by_uid[row["user_id"]] = row.get("name")
    except Exception as exc:
        logger.debug("fetch student_profiles for members failed: %s", exc)

    # 补 auth.users.email (走 Admin API, 一次一个: supabase-py 无批量)
    email_by_uid: dict[str, str | None] = {}
    try:
        for uid in user_ids:
            try:
                u = client.auth.admin.get_user_by_id(uid)
                user_obj = getattr(u, "user", None) or u
                email = getattr(user_obj, "email", None)
                # fallback: user_metadata 里可能有 display_name / full_name
                meta = getattr(user_obj, "user_metadata", None) or {}
                if not name_by_uid.get(uid):
                    name_by_uid[uid] = (
                        meta.get("display_name")
                        or meta.get("full_name")
                        or meta.get("name")
                    )
                email_by_uid[uid] = email
            except Exception:
                continue
    except Exception as exc:
        logger.debug("fetch auth users for members failed: %s", exc)

    for r in rows:
        uid = r["user_id"]
        r["display_name"] = name_by_uid.get(uid)
        r["email"] = email_by_uid.get(uid)
    return rows


def add_group_member(*, group_id: str, user_id: str, role: str = "member") -> dict:
    """加入群 (幂等: 已在则返回现有记录)。"""
    existing = get_group_member(group_id, user_id)
    if existing:
        return existing
    client = get_admin_client()
    row = {"group_id": group_id, "user_id": user_id, "role": role}
    resp = client.table("group_members").insert(row).execute()
    return (resp.data or [row])[0]


def remove_group_member(group_id: str, user_id: str) -> bool:
    client = get_admin_client()
    resp = (
        client.table("group_members")
        .delete()
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(resp.data)


def count_group_materials(group_id: str) -> int:
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .select("id", count="exact")
        .eq("group_id", group_id)
        .limit(1)
        .execute()
    )
    return resp.count or 0


def count_group_notes(group_id: str) -> int:
    client = get_admin_client()
    resp = (
        client.table("knowledge_notes")
        .select("id", count="exact")
        .eq("group_id", group_id)
        .limit(1)
        .execute()
    )
    return resp.count or 0


def update_group(group_id: str, fields: dict) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("groups")
        .update(fields)
        .eq("id", group_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def delete_group(group_id: str) -> bool:
    client = get_admin_client()
    resp = client.table("groups").delete().eq("id", group_id).execute()
    return bool(resp.data)


# -----------------------------------------------------------------------------
# Learning roadmaps (Phase 9)
# -----------------------------------------------------------------------------
def list_learning_roadmaps(owner_id: str) -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("learning_roadmaps")
        .select("*")
        .eq("owner_id", owner_id)
        .neq("status", "archived")
        .order("updated_at", desc=True)
        .execute()
    )
    return resp.data or []


def get_learning_roadmap(roadmap_id: str, owner_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("learning_roadmaps")
        .select("*")
        .eq("id", roadmap_id)
        .eq("owner_id", owner_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def create_learning_roadmap(owner_id: str, payload: dict[str, Any]) -> dict:
    client = get_admin_client()
    resp = (
        client.table("learning_roadmaps")
        .insert({"owner_id": owner_id, **payload})
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError("创建学习规划失败")
    return rows[0]


def update_learning_roadmap(
    roadmap_id: str,
    owner_id: str,
    fields: dict[str, Any],
) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("learning_roadmaps")
        .update(fields)
        .eq("id", roadmap_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


# -----------------------------------------------------------------------------
# Phase 10 · 练习工坊 (practice_specs)
# -----------------------------------------------------------------------------
def create_practice_spec(owner_id: str, payload: dict[str, Any]) -> dict:
    client = get_admin_client()
    resp = (
        client.table("practice_specs")
        .insert({"owner_id": owner_id, **payload})
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError("保存练习失败")
    return rows[0]


def list_practice_specs(owner_id: str) -> list[dict]:
    client = get_admin_client()
    resp = (
        client.table("practice_specs")
        .select("*")
        .eq("owner_id", owner_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


def get_practice_spec(spec_id: str, owner_id: str) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("practice_specs")
        .select("*")
        .eq("id", spec_id)
        .eq("owner_id", owner_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def update_practice_spec(
    spec_id: str, owner_id: str, fields: dict[str, Any]
) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("practice_specs")
        .update(fields)
        .eq("id", spec_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def delete_practice_spec(spec_id: str, owner_id: str) -> bool:
    client = get_admin_client()
    resp = (
        client.table("practice_specs")
        .delete()
        .eq("id", spec_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    return bool(resp.data)
