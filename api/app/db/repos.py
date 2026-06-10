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


def list_materials(owner_id: str, limit: int = 100) -> list[dict]:
    """学生维度的资料列表 (含平台公共资料)。"""
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .select("*")
        .or_(f"owner_id.eq.{owner_id},owner_type.eq.platform")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
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
    limit: int = 200,
) -> list[dict]:
    client = get_admin_client()
    q = (
        client.table("knowledge_notes")
        .select("*")
        .eq("owner_id", owner_id)
        .order("updated_at", desc=True)
        .limit(limit)
    )
    if agent_key:
        q = q.eq("agent_key", agent_key)
    if tag:
        # jsonb @> 用 contains
        q = q.contains("tags", [tag])
    resp = q.execute()
    return resp.data or []


def get_note(note_id: str, owner_id: str) -> dict | None:
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
