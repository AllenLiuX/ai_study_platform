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
