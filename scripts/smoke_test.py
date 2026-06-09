#!/usr/bin/env python3
"""
Phase 0 端到端冒烟测试。

会做这些事:
- 通过 Supabase Admin 创建一个临时测试用户(邮箱自动确认)
- 用 anon key 登录拿 JWT
- 用 JWT 调后端覆盖:
  * GET/PATCH /api/student/profile
  * GET /api/student/dashboard
  * GET /api/chat/agents
  * 对 4 个 Agent (班主任 / 数学 / 英语 / 语文) 各创建一次 session,验证 welcome 消息
  * 给班主任发一条消息,验证 SSE 流式回复 + 持久化
- 验证错误路径:无 Authorization、伪造 token
- 删除测试用户

用法:
  cd api && source .venv/bin/activate
  # 后端要先跑起来 (uvicorn app.main:app --port 8000)
  python ../scripts/smoke_test.py
"""

from __future__ import annotations

import json
import sys
import uuid
from dataclasses import dataclass

import httpx
from supabase import create_client

# 让 import app.* 可用
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from app.core.config import get_settings  # noqa: E402


BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")
RED = "\033[31m"
GRN = "\033[32m"
YLW = "\033[33m"
RST = "\033[0m"


@dataclass
class Stats:
    passed: int = 0
    failed: int = 0
    skipped: int = 0


stats = Stats()


def check(name: str, condition: bool, hint: str = "") -> bool:
    if condition:
        print(f"  {GRN}✓{RST} {name}")
        stats.passed += 1
        return True
    print(f"  {RED}✗{RST} {name}{(' — ' + hint) if hint else ''}")
    stats.failed += 1
    return False


def section(title: str) -> None:
    print(f"\n{YLW}— {title} —{RST}")


def main() -> int:
    s = get_settings()
    if not s.supabase_configured:
        print(f"{RED}Supabase 未配置,无法运行测试{RST}")
        return 2

    admin = create_client(s.supabase_url, s.supabase_service_role_key)
    anon = create_client(s.supabase_url, s.supabase_anon_key)

    section("基础健康检查")
    with httpx.Client(timeout=10) as c:
        r = c.get(f"{BASE}/health")
        check("GET /health == 200", r.status_code == 200, r.text[:100])
        r = c.get(f"{BASE}/health/config")
        cfg = r.json() if r.status_code == 200 else {}
        check("OpenAI configured", cfg.get("openai_configured") is True)
        check("Supabase configured", cfg.get("supabase_configured") is True)
        r = c.get(f"{BASE}/api/student/profile")
        check(
            "未带 token 调受保护接口 -> 401",
            r.status_code == 401,
            f"got {r.status_code}: {r.text[:100]}",
        )
        r = c.get(
            f"{BASE}/api/student/profile",
            headers={"Authorization": "Bearer fake.token.invalid"},
        )
        check(
            "伪造 token 调受保护接口 -> 401",
            r.status_code == 401,
            f"got {r.status_code}: {r.text[:100]}",
        )

    section("创建临时测试用户 + 登录")
    email = f"smoke+{uuid.uuid4().hex[:8]}@studentcoach.test"
    user_id: str | None = None
    try:
        admin.auth.admin.create_user(
            {
                "email": email,
                "password": "SmokeTest1234!",
                "email_confirm": True,
                "user_metadata": {"name": "小明(冒烟测试)"},
            }
        )
        print(f"  创建: {email}")

        sess = anon.auth.sign_in_with_password(
            {"email": email, "password": "SmokeTest1234!"}
        )
        token = sess.session.access_token
        user_id = sess.user.id
        check("Supabase 登录成功", bool(token and user_id))

        H = {"Authorization": f"Bearer {token}"}

        section("学生画像 (Student Profile)")
        with httpx.Client(timeout=30) as c:
            r = c.get(f"{BASE}/api/student/profile", headers=H)
            check("GET /api/student/profile -> 200", r.status_code == 200)
            check(
                "trigger 自动建了 profile (含 user_id)",
                r.json().get("user_id") == user_id,
            )

            r = c.patch(
                f"{BASE}/api/student/profile",
                headers=H,
                json={
                    "name": "小明(冒烟测试)",
                    "grade": "初二",
                    "target_exam": "期末",
                    "textbook_version": "人教版",
                    "focus_subjects": ["math", "english"],
                    "learning_goal": "数学冲 90+",
                    "onboarding_completed": True,
                },
            )
            check("PATCH /api/student/profile -> 200", r.status_code == 200)
            body = r.json()
            check("grade 写入成功", body.get("grade") == "初二")
            check(
                "focus_subjects 写入成功",
                set(body.get("focus_subjects") or []) == {"math", "english"},
            )
            check("onboarding 标志已置位", body.get("onboarding_completed") is True)

            r = c.get(f"{BASE}/api/student/dashboard", headers=H)
            check("GET /api/student/dashboard -> 200", r.status_code == 200)
            d = r.json()
            check("dashboard 含 3 个 subjects", len(d.get("subjects", [])) == 3)
            check("dashboard.profile 来自最新画像", d.get("profile", {}).get("grade") == "初二")

        section("Agent Registry")
        with httpx.Client(timeout=30) as c:
            r = c.get(f"{BASE}/api/chat/agents", headers=H)
            check("GET /api/chat/agents -> 200", r.status_code == 200)
            agents = r.json()
            types = {a["agent_type"] for a in agents}
            check(
                "返回 4 个 agent (班主任 + 数学/英语/语文)",
                types == {"head_teacher", "math_teacher", "english_teacher", "chinese_teacher"},
                f"got {types}",
            )

        section("会话 (Session) - 每个 Agent 创建一次")
        sessions: dict[str, str] = {}
        with httpx.Client(timeout=30) as c:
            for agent_type, subject_id in [
                ("head_teacher", None),
                ("math_teacher", "math"),
                ("english_teacher", "english"),
                ("chinese_teacher", "chinese"),
            ]:
                r = c.post(
                    f"{BASE}/api/chat/sessions",
                    headers=H,
                    json={"agent_type": agent_type, "subject_id": subject_id},
                )
                ok = check(
                    f"创建 {agent_type} session -> 200",
                    r.status_code == 200,
                    r.text[:200],
                )
                if not ok:
                    continue
                sid = r.json()["id"]
                sessions[agent_type] = sid

                r = c.get(f"{BASE}/api/chat/sessions/{sid}/messages", headers=H)
                msgs = r.json() if r.status_code == 200 else []
                check(
                    f"{agent_type} session 含 welcome 消息",
                    len(msgs) == 1 and msgs[0]["role"] == "assistant",
                )

            r = c.get(f"{BASE}/api/chat/sessions", headers=H)
            check("GET /api/chat/sessions 返回所有 4 个会话", len(r.json()) == 4)

        section("SSE 流式回复 (班主任 + 数学老师各 1 条)")
        with httpx.Client(timeout=120) as c:
            for agent_type, question in [
                ("head_teacher", "我数学想冲 90,英语想稳 85,这周该怎么安排?"),
                ("math_teacher", "一次函数 y=2x-3 的图像和 x 轴的交点是什么?"),
            ]:
                sid = sessions.get(agent_type)
                if not sid:
                    stats.skipped += 1
                    continue
                got_ready = False
                got_done = False
                got_delta = False
                ready_model: str | None = None
                done_model: str | None = None
                error_msg: str | None = None
                with c.stream(
                    "POST",
                    f"{BASE}/api/chat/sessions/{sid}/messages",
                    headers=H,
                    json={"content": question},
                ) as resp:
                    if resp.status_code != 200:
                        error_msg = f"status {resp.status_code} body {resp.read().decode()[:200]}"
                    else:
                        current = None
                        for raw in resp.iter_lines():
                            if not raw:
                                current = None
                                continue
                            if raw.startswith("event:"):
                                current = raw[6:].strip()
                            elif raw.startswith("data:"):
                                payload = json.loads(raw[5:].strip() or "{}")
                                if current == "ready":
                                    got_ready = True
                                    ready_model = payload.get("model")
                                elif current == "delta":
                                    got_delta = True
                                elif current == "done":
                                    got_done = True
                                    done_model = payload.get("model")
                                elif current == "error":
                                    error_msg = str(payload)
                check(f"{agent_type} SSE 收到 ready", got_ready, error_msg or "")
                check(f"{agent_type} SSE 收到 delta", got_delta, error_msg or "")
                check(f"{agent_type} SSE 收到 done", got_done, error_msg or "")
                check(
                    f"{agent_type} SSE ready/done 携带 model",
                    bool(ready_model) and bool(done_model),
                    f"ready={ready_model} done={done_model}",
                )

                r = c.get(f"{BASE}/api/chat/sessions/{sid}/messages", headers=H)
                msgs = r.json()
                check(
                    f"{agent_type} 持久化:welcome + user + assistant = 3",
                    len(msgs) == 3
                    and {m["role"] for m in msgs} == {"assistant", "user"}
                    and sum(1 for m in msgs if m["role"] == "user") == 1,
                )
                assistant_msgs = [
                    m for m in msgs if m["role"] == "assistant" and m.get("metadata")
                ]
                non_welcome = [
                    m
                    for m in assistant_msgs
                    if (m.get("metadata") or {}).get("kind") != "welcome"
                ]
                check(
                    f"{agent_type} 落库 assistant.metadata.model",
                    bool(non_welcome)
                    and (non_welcome[-1].get("metadata") or {}).get("model"),
                    f"metadata={non_welcome[-1].get('metadata') if non_welcome else None}",
                )

    finally:
        if user_id:
            section("清理")
            try:
                admin.auth.admin.delete_user(user_id)
                print(f"  已删除测试用户 {user_id[:8]}…")
            except Exception as exc:
                print(f"  ⚠ 删除失败: {exc}")

    print()
    print(f"{GRN}通过: {stats.passed}{RST}  {RED}失败: {stats.failed}{RST}  跳过: {stats.skipped}")
    if stats.failed:
        print(f"{RED}❌ 冒烟测试存在失败项{RST}")
        return 1
    print(f"{GRN}🎉 全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
