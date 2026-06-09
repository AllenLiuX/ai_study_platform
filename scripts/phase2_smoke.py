#!/usr/bin/env python
"""
Phase 2 冒烟:
- knowledge_points 是否已 seed
- 一轮学科对话后,BackgroundTasks 异步抽取并写入 student_progress
- GET /api/student/progress / /dashboard 返回真实 mastery + 薄弱点

注意:抽取是 BackgroundTasks 异步执行,本脚本会轮询等待 progress 出现。

前置:
- 已应用 0003_phase2_progress.sql
- 已运行 seed_knowledge_points.py 入库
- backend 在 127.0.0.1:8000
"""

from __future__ import annotations

import json
import sys
import time
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


def main() -> int:
    settings = get_settings()
    admin = make_admin()
    user_id: str | None = None

    try:
        section("准备测试学生 + 拿 token")
        suffix = uuid.uuid4().hex[:6]
        email = f"phase2-smoke-{suffix}@example.com"
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

        section("knowledge_points 已经 seed (RLS:authenticated 可读)")
        kp_check = (
            admin.table("knowledge_points")
            .select("id, subject_id, is_leaf", count="exact")
            .eq("is_leaf", True)
            .execute()
        )
        check(
            f"leaf 知识点 ≥ 50 (实际 {kp_check.count or 0})",
            (kp_check.count or 0) >= 50,
        )

        section("初始 dashboard:progress 字段存在 + 都是中性值")
        with httpx.Client(timeout=20) as c:
            r = c.get(f"{BASE}/api/student/dashboard", headers=H)
            check("GET /dashboard -> 200", r.status_code == 200, r.text[:120])
            dash = r.json()
            check("dashboard.progress 是数组", isinstance(dash.get("progress"), list))
            initial = {p["subject_id"]: p for p in dash["progress"]}
            for sid in ("math", "english", "chinese"):
                p = initial.get(sid)
                check(
                    f"{sid} 初始 covered_count=0 (实际 {p and p['covered_count']})",
                    p is not None and p["covered_count"] == 0,
                )

        section("跟数学老师对话 (会触发 progress 抽取)")
        with httpx.Client(timeout=60) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "math_teacher", "subject_id": "math"},
            )
            sid = r.json()["id"]

            saw_done = False
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{sid}/messages",
                headers=H,
                json={
                    "content": (
                        "老师我有点搞不清一元二次方程的判别式什么时候用,"
                        "Δ>0 / =0 / <0 分别代表什么意思?能不能举一个 x²-5x+6=0 的例子?"
                    )
                },
            ) as resp:
                current = None
                for raw in resp.iter_lines():
                    if not raw:
                        current = None
                        continue
                    if raw.startswith("event:"):
                        current = raw[6:].strip()
                    elif raw.startswith("data:") and current == "done":
                        saw_done = True
            check("一轮对话 done", saw_done)

        section("轮询等 BackgroundTask 完成抽取 (≤30s)")
        target_mastery_changed = False
        deadline = time.time() + 30
        progress_payload = None
        while time.time() < deadline:
            with httpx.Client(timeout=10) as c:
                r = c.get(f"{BASE}/api/student/progress", headers=H)
                if r.status_code != 200:
                    break
                items = {p["subject_id"]: p for p in r.json()}
                math_p = items.get("math")
                if math_p and math_p["covered_count"] > 0:
                    progress_payload = math_p
                    target_mastery_changed = True
                    break
            time.sleep(2)
        check(
            f"math 的 covered_count > 0 (实际 {progress_payload and progress_payload['covered_count']})",
            target_mastery_changed,
            f"30s 内 BackgroundTask 还没写入 student_progress",
        )

        if progress_payload:
            check(
                f"math 至少有 1 个薄弱点 (实际 {len(progress_payload['weak_points'])})",
                len(progress_payload["weak_points"]) >= 1,
            )
            check(
                "math 的当前章节非 None",
                progress_payload.get("current_chapter") is not None,
                f"current_chapter={progress_payload.get('current_chapter')}",
            )

        section("assistant 消息的 metadata 含 progress 字段")
        last_msgs = admin.table("chat_messages").select("metadata").eq("session_id", sid).order(
            "created_at", desc=True
        ).limit(3).execute()
        progress_seen = any(
            ((m.get("metadata") or {}).get("progress")) for m in (last_msgs.data or [])
        )
        check("assistant.metadata.progress 落库", progress_seen)

        section("跟班主任聊不应抽取 (head_teacher 跳过)")
        with httpx.Client(timeout=60) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "head_teacher", "subject_id": None},
            )
            sid2 = r.json()["id"]
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{sid2}/messages",
                headers=H,
                json={"content": "下周想冲刺一下,推荐每天怎么安排时间?"},
            ) as resp:
                for _ in resp.iter_lines():
                    pass

        time.sleep(3)
        before_english = next(
            (p for p in items.values() if p["subject_id"] == "english"), None
        )
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{BASE}/api/student/progress", headers=H)
            after = {p["subject_id"]: p for p in r.json()}
        check(
            "head_teacher 对话没有给 english 留痕迹",
            after.get("english", {}).get("covered_count", 0)
            == (before_english or {}).get("covered_count", 0),
        )

    finally:
        if user_id:
            section("清理测试用户")
            try:
                admin.auth.admin.delete_user(user_id)
                print(f"  已删除 {user_id[:8]}…")
            except Exception as exc:
                print(f"  ⚠ 删除失败: {exc}")

    print()
    print(f"{GRN}通过: {Stats.passed}{RST}  {RED}失败: {Stats.failed}{RST}")
    if Stats.failed:
        print(f"{RED}❌ Phase 2 冒烟存在失败{RST}")
        return 1
    print(f"{GRN}🎉 Phase 2 冒烟全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
