#!/usr/bin/env python
"""
Phase 2.5 冒烟: follow-up 引导 (学习流)

验证:
1. SSE 流里在 done 之前会收到 follow_ups 事件
2. items 不为空,question 字段非空,type 是允许的四种之一
3. assistant 消息 metadata.follow_ups 已落库
4. 学科老师 + 班主任 都能产出 follow-ups (不依赖 progress)
5. (锦上添花) 至少一条 type=deep_dive
"""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

import httpx
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from app.core.config import get_settings  # noqa: E402

BASE = "http://127.0.0.1:8000"
RED = "\033[31m"
GRN = "\033[32m"
YLW = "\033[33m"
RST = "\033[0m"

ALLOWED_TYPES = {"deep_dive", "explore", "practice", "review"}


class Stats:
    passed = 0
    failed = 0


def section(t: str) -> None:
    print(f"\n{YLW}— {t} —{RST}")


def check(label: str, ok: bool, info: str = "") -> bool:
    if ok:
        Stats.passed += 1
        print(f"  {GRN}✓{RST} {label}")
    else:
        Stats.failed += 1
        print(f"  {RED}✗{RST} {label}  {info}")
    return ok


def make_admin() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def stream_one_turn(
    *,
    client: httpx.Client,
    base: str,
    headers: dict,
    session_id: str,
    content: str,
) -> tuple[list[dict], bool, bool]:
    """单轮对话,返回 (follow_ups_items, saw_done, saw_follow_ups_before_done)。"""
    follow_ups: list[dict] = []
    saw_done = False
    follow_ups_before_done = False
    with client.stream(
        "POST",
        f"{base}/api/chat/sessions/{session_id}/messages",
        headers=headers,
        json={"content": content},
    ) as resp:
        if resp.status_code != 200:
            print(f"  ✗ status {resp.status_code}: {resp.read().decode()[:200]}")
            return follow_ups, saw_done, follow_ups_before_done

        current = None
        for raw in resp.iter_lines():
            if not raw:
                current = None
                continue
            if raw.startswith("event:"):
                current = raw[6:].strip()
            elif raw.startswith("data:"):
                payload = json.loads(raw[5:].strip() or "{}")
                if current == "follow_ups":
                    follow_ups = payload.get("items") or []
                    if not saw_done:
                        follow_ups_before_done = True
                elif current == "done":
                    saw_done = True
    return follow_ups, saw_done, follow_ups_before_done


def main() -> int:
    settings = get_settings()
    admin = make_admin()
    user_id: str | None = None

    try:
        section("准备测试学生 + token")
        suffix = uuid.uuid4().hex[:6]
        email = f"phase25-smoke-{suffix}@example.com"
        password = "Smoke-1234!"
        created = admin.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        )
        user_id = created.user.id
        with httpx.Client(timeout=20) as c:
            r = c.post(
                f"{settings.supabase_url}/auth/v1/token",
                params={"grant_type": "password"},
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Content-Type": "application/json",
                },
                json={"email": email, "password": password},
            )
            token = r.json()["access_token"]
        H = {"Authorization": f"Bearer {token}"}

        section("数学老师对话 → SSE follow_ups 事件出现")
        with httpx.Client(timeout=90) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "math_teacher", "subject_id": "math"},
            )
            sid = r.json()["id"]
            items, saw_done, before_done = stream_one_turn(
                client=c,
                base=BASE,
                headers=H,
                session_id=sid,
                content=(
                    "老师,二次函数 y=x²-4x+3 的顶点怎么求?"
                    "我学过配方法但总是搞错符号。"
                ),
            )

        check("一轮对话 done", saw_done)
        check(f"收到 follow_ups SSE 事件 (实际 {len(items)} 条)", len(items) >= 2)
        check("follow_ups 在 done 之前到达", before_done)
        if items:
            check(
                "每条 follow-up 都有 type ∈ {deep_dive,explore,practice,review}",
                all(fu.get("type") in ALLOWED_TYPES for fu in items),
                json.dumps([fu.get("type") for fu in items]),
            )
            check(
                "每条 follow-up 都有 question",
                all(bool((fu.get("question") or "").strip()) for fu in items),
            )
            check(
                "至少 1 条 type=deep_dive",
                any(fu.get("type") == "deep_dive" for fu in items),
                json.dumps([fu.get("type") for fu in items]),
            )

        section("metadata.follow_ups 已落库 (重新加载消息能拿到)")
        with httpx.Client(timeout=20) as c:
            r = c.get(f"{BASE}/api/chat/sessions/{sid}/messages", headers=H)
            msgs = r.json()
        last_assistant = next(
            (
                m
                for m in reversed(msgs)
                if m["role"] == "assistant"
                and (m.get("metadata") or {}).get("kind") != "welcome"
            ),
            None,
        )
        stored = (last_assistant or {}).get("metadata", {}).get("follow_ups", [])
        check(
            f"assistant.metadata.follow_ups 数量 ≥ 2 (实际 {len(stored)})",
            len(stored) >= 2,
        )

        section("班主任也能产出 follow_ups (与学科无关)")
        with httpx.Client(timeout=90) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "head_teacher", "subject_id": None},
            )
            sid2 = r.json()["id"]
            items2, saw_done2, _ = stream_one_turn(
                client=c,
                base=BASE,
                headers=H,
                session_id=sid2,
                content="下周月考前我感觉时间紧,数学和英语怎么排比较好?",
            )
        check("班主任对话 done", saw_done2)
        check(f"班主任也给了 ≥ 2 条建议 (实际 {len(items2)})", len(items2) >= 2)

    finally:
        if user_id:
            section("清理")
            try:
                admin.auth.admin.delete_user(user_id)
                print(f"  已删除 {user_id[:8]}…")
            except Exception as exc:
                print(f"  ⚠ 删除失败: {exc}")

    print()
    print(f"{GRN}通过: {Stats.passed}{RST}  {RED}失败: {Stats.failed}{RST}")
    if Stats.failed:
        print(f"{RED}❌ Phase 2.5 冒烟存在失败{RST}")
        return 1
    print(f"{GRN}🎉 Phase 2.5 冒烟全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
