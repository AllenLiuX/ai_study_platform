#!/usr/bin/env python3
"""Phase 1 端到端冒烟测试 (资料上传 + RAG)。

依赖:
- 后端跑在 http://127.0.0.1:8000
- supabase / openai 在 .env 中配好

会做这些事:
- 创建临时测试用户
- 上传一份 TXT 教辅笔记
- 轮询 parse_status 直到 ready (或 failed)
- 验证 list/get/chunks 数据
- 创建数学老师 session,带 material_ids 提问
- 验证 SSE 流出现 citations 事件,assistant 消息 metadata 含 citations
- 不带 material_ids 提问做对照
- 删除资料,验证级联清理
- 清理测试用户
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid

import httpx
from supabase import create_client

# 导入后端 settings
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from app.core.config import get_settings  # noqa: E402


BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")
RED = "\033[31m"
GRN = "\033[32m"
YLW = "\033[33m"
RST = "\033[0m"

# 一份精心准备的初二数学笔记,覆盖一次函数 + 二次函数 + 几何
SAMPLE_NOTE = """
# 初二数学复习笔记 — 函数与几何

## 一、一次函数
一次函数的标准形式是 y = kx + b。其中 k 是斜率,b 是 y 轴截距。
当 k > 0 时,函数单调递增;当 k < 0 时,函数单调递减。
图像是一条直线。它与 x 轴的交点是 (-b/k, 0),与 y 轴的交点是 (0, b)。
两条不同的直线 y1=k1*x+b1 与 y2=k2*x+b2 平行的充要条件是 k1=k2 且 b1≠b2。
两条直线垂直的充要条件是 k1*k2=-1。
例题:已知一次函数 y=2x-3,求它与坐标轴的交点。解:令 y=0 得 x=3/2,故与 x 轴交点为 (3/2,0)。令 x=0 得 y=-3,故与 y 轴交点为 (0,-3)。

## 二、二次函数
二次函数的标准形式是 y = ax^2 + bx + c (a≠0)。
当 a > 0 时,抛物线开口向上,有最小值;当 a < 0 时,开口向下,有最大值。
顶点坐标公式:顶点横坐标 x0 = -b / (2a),纵坐标 y0 = c - b^2 / (4a)。
对称轴是直线 x = -b / (2a)。
判别式 Δ = b^2 - 4ac:Δ>0 时与 x 轴有两个交点;Δ=0 时与 x 轴相切于一点;Δ<0 时与 x 轴无交点。

## 三、勾股定理
直角三角形两直角边为 a 和 b,斜边为 c。则 a^2 + b^2 = c^2。
逆定理:如果三角形的三边满足 a^2+b^2=c^2,则它是直角三角形,斜边为 c。
常用勾股数:3,4,5; 5,12,13; 8,15,17; 7,24,25。

## 四、平行四边形与矩形
平行四边形对边相等且平行,对角线互相平分。
矩形是有一个角为直角的平行四边形,对角线相等。
菱形是四边都相等的平行四边形,对角线互相垂直平分。
正方形同时具备矩形和菱形的所有性质。
""".strip()


def check(name: str, ok: bool, hint: str = "") -> bool:
    if ok:
        print(f"  {GRN}✓{RST} {name}")
        return True
    print(f"  {RED}✗{RST} {name}{(' — ' + hint) if hint else ''}")
    return False


def section(title: str) -> None:
    print(f"\n{YLW}— {title} —{RST}")


def main() -> int:
    s = get_settings()
    admin = create_client(s.supabase_url, s.supabase_service_role_key)
    anon = create_client(s.supabase_url, s.supabase_anon_key)

    passed = 0
    failed = 0

    def _c(name: str, ok: bool, hint: str = "") -> None:
        nonlocal passed, failed
        if check(name, ok, hint):
            passed += 1
        else:
            failed += 1

    email = f"phase1+{uuid.uuid4().hex[:8]}@studentcoach.test"
    user_id: str | None = None
    material_id: str | None = None

    try:
        admin.auth.admin.create_user(
            {
                "email": email,
                "password": "Phase1Test1234!",
                "email_confirm": True,
                "user_metadata": {"name": "Phase1 测试"},
            }
        )
        sess = anon.auth.sign_in_with_password(
            {"email": email, "password": "Phase1Test1234!"}
        )
        token = sess.session.access_token
        user_id = sess.user.id
        H = {"Authorization": f"Bearer {token}"}

        section("资料上传")
        with httpx.Client(timeout=30) as c:
            files = {
                "file": (
                    "math_notes.md",
                    SAMPLE_NOTE.encode("utf-8"),
                    "text/markdown",
                )
            }
            data = {
                "title": "初二数学复习笔记",
                "subject_id": "math",
                "grade": "初二",
                "material_type": "note",
            }
            r = c.post(
                f"{BASE}/api/materials",
                headers=H,
                files=files,
                data=data,
            )
            _c("POST /api/materials -> 200", r.status_code == 200, r.text[:200])
            if r.status_code != 200:
                return 1
            body = r.json()
            material_id = body["id"]
            _c("返回 parse_status='pending'", body["parse_status"] == "pending")
            _c("subject_id 透传", body["subject_id"] == "math")
            _c("size_bytes > 0", body["size_bytes"] > 0)

        section("后台异步处理 (parse + chunk + embed)")
        with httpx.Client(timeout=30) as c:
            deadline = time.time() + 60
            final_status = None
            chunk_count = 0
            while time.time() < deadline:
                r = c.get(f"{BASE}/api/materials/{material_id}", headers=H)
                if r.status_code != 200:
                    break
                m = r.json()
                final_status = m["parse_status"]
                chunk_count = m["chunk_count"]
                if final_status in {"ready", "failed"}:
                    break
                time.sleep(1.0)
            _c(
                f"parse_status 最终 = ready (实际 {final_status})",
                final_status == "ready",
                f"parse_error: {m.get('parse_error')}" if final_status == "failed" else "",
            )
            _c("chunk_count > 0", chunk_count > 0, f"got {chunk_count}")
            r = c.get(f"{BASE}/api/materials", headers=H)
            _c("GET /api/materials 列出含新资料", any(x["id"] == material_id for x in r.json()))

        section("RAG 召回 (math_teacher session + material_ids)")
        with httpx.Client(timeout=120) as c:
            r = c.post(
                f"{BASE}/api/chat/sessions",
                headers=H,
                json={"agent_type": "math_teacher", "subject_id": "math"},
            )
            _c("创建 math session -> 200", r.status_code == 200, r.text[:200])
            session_id = r.json()["id"]

            citations: list[dict] = []
            saw_ready = saw_done = False
            assistant_text = ""
            error_msg: str | None = None
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{session_id}/messages",
                headers=H,
                json={
                    "content": "顶点公式是什么?二次函数 y = 2x^2 - 4x + 1 的顶点坐标是?",
                    "material_ids": [material_id],
                },
            ) as resp:
                if resp.status_code != 200:
                    error_msg = f"status {resp.status_code}: {resp.read().decode()[:200]}"
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
                                citations = payload.get("items") or []
                            elif current == "delta":
                                assistant_text += payload.get("text", "")
                            elif current == "done":
                                saw_done = True
                            elif current == "error":
                                error_msg = str(payload)
            _c("SSE 看到 ready / done", saw_ready and saw_done and not error_msg, error_msg or "")
            _c("SSE 收到 citations 事件", len(citations) > 0, f"got {len(citations)}")
            if citations:
                top = citations[0]
                _c(
                    "top citation 指向上传的资料",
                    top.get("material_id") == material_id,
                    f"got {top.get('material_id')[:8]}…",
                )
                _c(
                    "top citation 相似度 > 0.3",
                    float(top.get("similarity") or 0) > 0.3,
                    f"sim={top.get('similarity')}",
                )

            # 验证 assistant message metadata 落库
            r = c.get(f"{BASE}/api/chat/sessions/{session_id}/messages", headers=H)
            msgs = r.json()
            assistant_msgs = [m for m in msgs if m["role"] == "assistant"]
            last = assistant_msgs[-1] if assistant_msgs else None
            stored_citations = (last or {}).get("metadata", {}).get("citations") or []
            _c("assistant 消息 metadata.citations 已落库", len(stored_citations) > 0)
            _c("assistant 内容非空", bool((last or {}).get("content")))

            # 不带 material_ids 的对照
            with c.stream(
                "POST",
                f"{BASE}/api/chat/sessions/{session_id}/messages",
                headers=H,
                json={"content": "你刚才那道题答错了吗?请简短确认。"},
            ) as resp:
                cit2: list[dict] = []
                current = None
                for raw in resp.iter_lines():
                    if not raw:
                        current = None
                        continue
                    if raw.startswith("event:"):
                        current = raw[6:].strip()
                    elif raw.startswith("data:"):
                        payload = json.loads(raw[5:].strip() or "{}")
                        if current == "citations":
                            cit2 = payload.get("items") or []
                _c("不传 material_ids 时不召回任何 citations", cit2 == [])

        section("删除资料 (级联清掉 chunks + Storage)")
        with httpx.Client(timeout=15) as c:
            r = c.delete(f"{BASE}/api/materials/{material_id}", headers=H)
            _c("DELETE /api/materials/{id} -> 204", r.status_code == 204, r.text[:120])
            r = c.get(f"{BASE}/api/materials/{material_id}", headers=H)
            _c("再次 GET 已 404", r.status_code == 404)

    finally:
        if user_id:
            section("清理测试用户")
            try:
                admin.auth.admin.delete_user(user_id)
                print(f"  已删除 {user_id[:8]}…")
            except Exception as exc:
                print(f"  删除失败: {exc}")

    print()
    print(f"{GRN}通过: {passed}{RST}  {RED}失败: {failed}{RST}")
    if failed:
        print(f"{RED}❌ 存在失败项{RST}")
        return 1
    print(f"{GRN}🎉 Phase 1 冒烟全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
