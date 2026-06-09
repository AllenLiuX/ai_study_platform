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
