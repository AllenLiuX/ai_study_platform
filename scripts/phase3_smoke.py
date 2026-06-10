#!/usr/bin/env python
"""
Phase 3 冒烟:今日推荐任务
- GET /api/student/tasks/today 返回合法的 3 条任务
- 缓存幂等:第二次 cached=true,任务 id 不变
- force refresh:数据库记录 updated_at 推进
- /dashboard.tasks 字段存在 + 与 /tasks/today 一致
- 新用户 (无 progress) 走兜底任务集
- 跟数学老师对话后 force refresh,LLM 任务的多样性约束:
  - 长度 2-3
  - tag/agent_type 合法
  - 至少 1 个 head_teacher (规划)
  - 至少覆盖 2 个 subject_label / agent_type

前置:
- 已应用 0004_phase3_daily_tasks.sql
- 已 seed knowledge_points
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

import os

BASE = os.environ.get("SMOKE_API_BASE", "http://127.0.0.1:8000")
RED = "\033[31m"
GRN = "\033[32m"
YLW = "\033[33m"
RST = "\033[0m"

ALLOWED_TAGS = {"薄弱", "复习", "新学", "规划"}
ALLOWED_AGENTS = {"head_teacher", "math_teacher", "english_teacher", "chinese_teacher"}


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


def _validate_task_shape(task: dict) -> tuple[bool, str]:
    required = (
        "id",
        "title",
        "description",
        "subject_label",
        "agent_type",
        "estimated_minutes",
        "tag",
        "starter_prompt",
    )
    for k in required:
        if k not in task:
            return False, f"缺字段 {k}"
    if task["agent_type"] not in ALLOWED_AGENTS:
        return False, f"agent_type={task['agent_type']} 不合法"
    if task["tag"] not in ALLOWED_TAGS:
        return False, f"tag={task['tag']} 不合法"
    if not isinstance(task["estimated_minutes"], int) or not (
        3 <= task["estimated_minutes"] <= 60
    ):
        return False, f"estimated_minutes 非法 {task['estimated_minutes']}"
    if not task["title"] or not task["starter_prompt"]:
        return False, "title / starter_prompt 不能为空"
    # head_teacher 与 学科一致性
    if task["agent_type"] == "head_teacher":
        if task.get("subject_id") not in (None, ""):
            return False, "head_teacher 的 subject_id 应为 null"
    else:
        if task.get("subject_id") not in ("math", "english", "chinese"):
            return False, f"学科老师的 subject_id 必须是 math/english/chinese,实际 {task.get('subject_id')}"
    return True, ""


def main() -> int:
    settings = get_settings()
    admin = make_admin()
    user_id: str | None = None

    try:
        section("准备测试学生 + 登录拿 token")
        suffix = uuid.uuid4().hex[:6]
        email = f"phase3-smoke-{suffix}@example.com"
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

        section("新用户首次 GET /tasks/today → 兜底任务集")
        with httpx.Client(timeout=30) as c:
            r = c.get(f"{BASE}/api/student/tasks/today", headers=H)
            check("GET /tasks/today -> 200", r.status_code == 200, r.text[:200])
            data = r.json()
            tasks_v1 = data.get("tasks") or []
            check(f"tasks 长度 = 3 (实际 {len(tasks_v1)})", len(tasks_v1) == 3)
            for i, t in enumerate(tasks_v1):
                ok, info = _validate_task_shape(t)
                check(f"task[{i}] shape ok", ok, info or json.dumps(t)[:120])
            check(
                "cached=false (首次生成)",
                data.get("cached") is False,
                f"实际 cached={data.get('cached')}",
            )

        section("第二次 GET /tasks/today → 命中缓存,id 不变")
        with httpx.Client(timeout=10) as c:
            r2 = c.get(f"{BASE}/api/student/tasks/today", headers=H)
            data2 = r2.json()
            tasks_v2 = data2.get("tasks") or []
            check("cached=true", data2.get("cached") is True)
            ids_v1 = [t["id"] for t in tasks_v1]
            ids_v2 = [t["id"] for t in tasks_v2]
            check(
                "任务 id 列表幂等 (按顺序相同)",
                ids_v1 == ids_v2,
                f"v1={ids_v1} v2={ids_v2}",
            )

        section("数据库里应该有一行 student_daily_tasks")
        rows = (
            admin.table("student_daily_tasks")
            .select("*", count="exact")
            .eq("student_id", user_id)
            .execute()
        )
        check(
            f"student_daily_tasks 命中 1 行 (实际 {rows.count or 0})",
            (rows.count or 0) == 1,
        )

        section("GET /dashboard 应该包含 tasks 字段且与 /tasks/today 一致")
        with httpx.Client(timeout=30) as c:
            r3 = c.get(f"{BASE}/api/student/dashboard", headers=H)
            dash = r3.json()
            tasks_in_dash = (dash.get("tasks") or {}).get("tasks") or []
            check(
                "dashboard.tasks.tasks 与 /tasks/today 一致",
                [t["id"] for t in tasks_in_dash] == ids_v1,
                f"dash ids={[t['id'] for t in tasks_in_dash]}",
            )

        section("force refresh → 任务会被重新生成 (id 可能改变)")
        # 等 1s 让 updated_at 有可观察差异
        first_updated = rows.data[0]["updated_at"] if rows.data else None
        time.sleep(1.2)
        with httpx.Client(timeout=60) as c:
            r4 = c.get(
                f"{BASE}/api/student/tasks/today?refresh=true", headers=H
            )
            data4 = r4.json()
            tasks_v4 = data4.get("tasks") or []
            check(f"refresh 后仍是 2-3 条 (实际 {len(tasks_v4)})", 2 <= len(tasks_v4) <= 3)
            check("refresh 后 cached=false", data4.get("cached") is False)
            for i, t in enumerate(tasks_v4):
                ok, info = _validate_task_shape(t)
                check(f"refresh.task[{i}] shape ok", ok, info)

        rows_after = (
            admin.table("student_daily_tasks")
            .select("*", count="exact")
            .eq("student_id", user_id)
            .execute()
        )
        check(
            "依然只有 1 行 (按日期 upsert)",
            (rows_after.count or 0) == 1,
        )
        if rows_after.data and first_updated:
            check(
                "updated_at 推进",
                rows_after.data[0]["updated_at"] > first_updated,
                f"first={first_updated} new={rows_after.data[0]['updated_at']}",
            )

        section("先让数学进度有信号,再 force refresh,看任务多样性")
        with httpx.Client(timeout=60) as c:
            r5 = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "math_teacher", "subject_id": "math"},
            )
            chat_sid = r5.json()["id"]
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{chat_sid}/messages",
                headers=H,
                json={
                    "content": (
                        "老师我一元二次方程判别式总记混,Δ>0/=0/<0 分别什么含义?"
                        "我做 x²-5x+6=0 老是算错符号,能讲下步骤吗?"
                    )
                },
            ) as resp:
                for _ in resp.iter_lines():
                    pass

        # 等 BackgroundTask 把 progress 写入
        deadline = time.time() + 30
        math_has_progress = False
        while time.time() < deadline:
            with httpx.Client(timeout=10) as c:
                rp = c.get(f"{BASE}/api/student/progress", headers=H)
                items = {p["subject_id"]: p for p in rp.json()}
            math_p = items.get("math") or {}
            if math_p.get("covered_count", 0) > 0:
                math_has_progress = True
                break
            time.sleep(2)
        check("数学已抽取出 progress (background task 完成)", math_has_progress)

        if math_has_progress:
            time.sleep(1.0)
            with httpx.Client(timeout=60) as c:
                r6 = c.get(
                    f"{BASE}/api/student/tasks/today?refresh=true", headers=H
                )
                data6 = r6.json()
                tasks_v6 = data6.get("tasks") or []
                check(
                    f"基于真实信号的任务 2-3 条 (实际 {len(tasks_v6)})",
                    2 <= len(tasks_v6) <= 3,
                )
                # 至少 1 个 head_teacher
                has_planner = any(t["agent_type"] == "head_teacher" for t in tasks_v6)
                check("至少 1 个 head_teacher (规划) 任务", has_planner)
                # 至少覆盖 2 个 agent_type (多样性)
                distinct_agents = {t["agent_type"] for t in tasks_v6}
                check(
                    f"任务覆盖 ≥ 2 种 agent_type (实际 {distinct_agents})",
                    len(distinct_agents) >= 2,
                )
                # 模型字段写回
                check(
                    f"返回的 model 字段非空 (实际 {data6.get('model')})",
                    bool(data6.get("model")),
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
        print(f"{RED}❌ Phase 3 冒烟存在失败{RST}")
        return 1
    print(f"{GRN}🎉 Phase 3 冒烟全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
