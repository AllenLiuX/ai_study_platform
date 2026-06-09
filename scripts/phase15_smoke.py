#!/usr/bin/env python
"""
Phase 1.5 冒烟:
- 平台公共资料 (owner_type='platform') 是否对任意学生用户可见
- 在 RAG 检索时,如果学生只勾选一份 platform 资料,能否正常召回 + citations

前置:
- 已运行 scripts/seed_platform_materials.py,公共资料里至少有 1 份 ready
- backend 在 127.0.0.1:8000
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


def make_admin_client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def main() -> int:
    settings = get_settings()
    if not settings.supabase_configured:
        print("✗ supabase 未配置")
        return 1

    admin = make_admin_client()
    user_id: str | None = None

    try:
        section("准备测试学生 + 拿 access token")
        suffix = uuid.uuid4().hex[:6]
        email = f"phase15-smoke-{suffix}@example.com"
        password = "Smoke-1234!"

        created = admin.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        )
        user_id = created.user.id
        print(f"  新建测试用户 {user_id[:8]}…")

        # 拿 access token
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
            check("Supabase signInWithPassword -> 200", r.status_code == 200, r.text[:120])
            token = r.json().get("access_token")
            check("拿到 access_token", bool(token))

        H = {"Authorization": f"Bearer {token}"}

        section("GET /api/materials 应该包含 platform 资料")
        with httpx.Client(timeout=30) as c:
            r = c.get(f"{BASE}/api/materials", headers=H)
            check("GET /api/materials -> 200", r.status_code == 200, r.text[:200])
            items = r.json()
            platform_items = [m for m in items if m.get("owner_type") == "platform"]
            own_items = [m for m in items if m.get("owner_type") == "student"]
            check(
                f"列表里包含 platform 资料 (拿到 {len(platform_items)} 份)",
                len(platform_items) >= 1,
            )
            check(
                f"新用户的私有资料为 0 (own={len(own_items)})",
                len(own_items) == 0,
            )

            # 挑一份 ready 的 platform 资料用于 RAG
            ready_platform = [m for m in platform_items if m.get("parse_status") == "ready"]
            check("至少有 1 份 ready 的 platform 资料", len(ready_platform) > 0)
            if not ready_platform:
                return 2
            sample = ready_platform[0]

        section("基于公共资料的 RAG 检索 (math session)")
        with httpx.Client(timeout=60) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "math_teacher", "subject_id": "math"},
            )
            check("创建 math session -> 200", r.status_code == 200, r.text[:200])
            sid = r.json()["id"]

            # 用一个跟随机 sample 资料主题相关的问题
            question = (
                f"请基于资料解释一下「{sample['title']}」里讲的核心概念,"
                f"用初中生能听懂的语言,2 句话就好。"
            )
            saw_ready = saw_done = False
            citations_payload: list[dict] = []
            error_msg: str | None = None
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{sid}/messages",
                headers=H,
                json={"content": question, "material_ids": [sample["id"]]},
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
                                saw_ready = True
                            elif current == "citations":
                                citations_payload = payload.get("items") or []
                            elif current == "done":
                                saw_done = True
                            elif current == "error":
                                error_msg = str(payload)
            check("SSE ready + done", saw_ready and saw_done and not error_msg, error_msg or "")
            check(
                f"SSE 收到 citations,且首条指向我们选的资料 (取到 {len(citations_payload)} 段)",
                bool(citations_payload)
                and citations_payload[0].get("material_id") == sample["id"],
            )
            top_sim = citations_payload[0].get("similarity") if citations_payload else 0.0
            check(
                f"首条 citation 相似度 > 0.4 (实际 {top_sim:.3f})",
                top_sim and top_sim > 0.4,
            )

            r = c.get(f"{BASE}/api/chat/sessions/{sid}/messages", headers=H)
            msgs = r.json()
            assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
            non_welcome = [
                m for m in assistant_msgs if (m.get("metadata") or {}).get("kind") != "welcome"
            ]
            check(
                "assistant 消息 metadata.citations 已落库",
                bool(non_welcome)
                and (non_welcome[-1].get("metadata") or {}).get("citations"),
            )

        section("学生不能删除 platform 资料")
        with httpx.Client(timeout=20) as c:
            r = c.delete(f"{BASE}/api/materials/{sample['id']}", headers=H)
            # 业务上,delete_material 限制 owner_id==own,所以 platform 资料应该 404 或 403
            check(
                f"DELETE platform material 应被拒 (实际 {r.status_code})",
                r.status_code in (404, 403),
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
        print(f"{RED}❌ Phase 1.5 冒烟存在失败{RST}")
        return 1
    print(f"{GRN}🎉 Phase 1.5 冒烟全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
