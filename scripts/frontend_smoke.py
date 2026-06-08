#!/usr/bin/env python3
"""前端冒烟测试。

假定:
- web 已经 `npm run build` 过
- 已经启动 `npm run start --port 3000`

验证项:
- 中间件:未登录访问受保护路由 (dashboard/onboarding/chat) -> 307 → /login
- 中间件:未登录访问 / -> 307 → /login (page.tsx 自己 redirect)
- /login, /signup 静态页 200
- 静态 HTML 含中文 lang、title、产品名
- /login 静态 HTML 是 Suspense fallback (生产构建特性,客户端 hydrate 后才显示表单)
- 各页面引用了 Next.js client 运行时 (bundle 注入正确)
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000"
RED = "\033[31m"
GRN = "\033[32m"
YLW = "\033[33m"
RST = "\033[0m"

passed = 0
failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        print(f"  {GRN}✓{RST} {name}")
        passed += 1
    else:
        print(f"  {RED}✗{RST} {name}{(' — ' + detail) if detail else ''}")
        failed += 1


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):  # type: ignore[override]
        return None


opener = urllib.request.build_opener(NoRedirect)


def fetch(path: str) -> tuple[int, str, dict]:
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": "smoke/0.1"})
    try:
        with opener.open(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)


def section(title: str) -> None:
    print(f"\n{YLW}— {title} —{RST}")


def main() -> int:
    section("中间件 / 路由保护")

    status, body, headers = fetch("/")
    loc = headers.get("location") or headers.get("Location") or ""
    check(
        "GET / 未登录 -> 307 到 /login",
        status == 307 and "/login" in loc,
        f"status={status} loc={loc}",
    )

    for path in ["/dashboard", "/onboarding", "/chat/00000000-0000-0000-0000-000000000000"]:
        status, _, headers = fetch(path)
        loc = headers.get("location") or headers.get("Location") or ""
        check(
            f"GET {path} 未登录 -> 307 到 /login (含 from 参数)",
            status == 307 and "/login" in loc and "from=" in loc,
            f"status={status} loc={loc}",
        )

    section("公开页面 (login / signup)")

    status, body, _ = fetch("/login")
    check("GET /login -> 200", status == 200)
    check("lang='zh-CN' 已设置", 'lang="zh-CN"' in body)
    check("title 含产品名", "<title>学生学习驾驶舱" in body)
    check("品牌名出现在 body", "学生学习驾驶舱" in body)
    check(
        "Suspense fallback '加载中' 出现 (生产构建预期行为)",
        "加载中" in body,
        "若没看到,说明 useSearchParams 未被 Suspense 包裹",
    )
    check("含 Next.js runtime bundle", "_next/static/chunks" in body)

    status, body, _ = fetch("/signup")
    check("GET /signup -> 200", status == 200)
    check("/signup 含 '注册新账号' 标题", "注册新账号" in body)
    check("/signup 含密码输入", 'type="password"' in body)
    check("/signup 含表单提交按钮", "创建账号" in body)
    check("/signup 含返回登录链接", "直接登录" in body)

    print()
    print(f"{GRN}通过: {passed}{RST}  {RED}失败: {failed}{RST}")
    if failed:
        print(f"{RED}❌ 前端冒烟测试存在失败项{RST}")
        return 1
    print(f"{GRN}🎉 前端冒烟测试全部通过{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
