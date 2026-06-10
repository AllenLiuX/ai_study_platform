#!/usr/bin/env python
"""Phase 4 冒烟:图片对话基础链路。

不依赖跑起的 uvicorn,直接在 process 内 import chat_service。
- 上传一张小测试 PNG 到 chat-attachments bucket
- 验证 _load_attachment_data_url 返回 data:image/png;base64,... URL
- 验证 _enrich_history_with_images 在 user msg 上挂 _image_data_urls
- 验证 agent runtime build_messages 把它拼成 OpenAI multimodal content array
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from app.agents.registry import get_agent  # noqa: E402
from app.agents.runtime import build_messages  # noqa: E402
from app.db.supabase_client import get_admin_client  # noqa: E402
from app.services.chat_service import (  # noqa: E402
    _enrich_history_with_images,
    _load_attachment_data_url,
)

# 一个最小的 1x1 PNG (透明像素),刚好用来 round-trip
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d4944415478da636060600000000050001000a8d8ed420000000049"
    "454e44ae426082"
)

BUCKET = "chat-attachments"
TEST_UID = "00000000-0000-0000-0000-0000000000a4"

GREEN = "\033[32m"
RED = "\033[31m"
NC = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓ {msg}{NC}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{NC}")
    sys.exit(1)


async def main() -> None:
    client = get_admin_client()
    storage_path = f"{TEST_UID}/{uuid.uuid4()}.png"
    # 1. upload
    try:
        client.storage.from_(BUCKET).upload(
            storage_path,
            TINY_PNG,
            file_options={"content-type": "image/png", "upsert": "false"},
        )
    except Exception as exc:
        fail(f"storage upload failed: {exc}")
    ok(f"上传成功: {storage_path}")

    try:
        # 2. _load_attachment_data_url
        data_url = await _load_attachment_data_url(storage_path)
        if not data_url:
            fail("_load_attachment_data_url 返回 None")
        if not data_url.startswith("data:image/png;base64,"):
            fail(f"data URL 前缀错: {data_url[:40]}")
        ok(f"_load_attachment_data_url 返回 {data_url[:48]}… (len={len(data_url)})")

        # 3. _enrich_history_with_images
        history = [
            {"role": "user", "content": "看看这道题", "metadata": {"image_urls": [storage_path]}},
            {"role": "assistant", "content": "好的,你想从哪一步开始?"},
            {"role": "user", "content": "下一步", "metadata": {}},
        ]
        enriched = await _enrich_history_with_images(history)
        if "_image_data_urls" not in enriched[0]:
            fail("第一条 user msg 没挂上 _image_data_urls")
        if len(enriched[0]["_image_data_urls"]) != 1:
            fail("image_data_urls 数量不对")
        if "_image_data_urls" in enriched[2]:
            fail("第二条 user msg 不该有图,却挂了字段")
        ok("_enrich_history_with_images 工作正常")

        # 4. build_messages → multimodal content
        messages = build_messages(
            agent=get_agent("math_teacher"),
            history=enriched,
            student_profile=None,
            rag_context=None,
        )
        # 找到第一条 user message
        u0 = next(m for m in messages if m["role"] == "user")
        if not isinstance(u0["content"], list):
            fail(f"第一条 user content 应该是 list, got {type(u0['content'])}")
        if not any(p.get("type") == "image_url" for p in u0["content"]):
            fail("user content 中没有 image_url 段")
        if not any(p.get("type") == "text" for p in u0["content"]):
            fail("user content 中没有 text 段")
        ok("build_messages 正确拼接 multimodal user content")

        # 5. 第二条 user (无图) 仍然是字符串
        u1 = [m for m in messages if m["role"] == "user"][1]
        if not isinstance(u1["content"], str):
            fail(f"第二条 user content 应该是 str, got {type(u1['content'])}")
        ok("无图 user msg 保持字符串 content")

    finally:
        # 清理
        try:
            client.storage.from_(BUCKET).remove([storage_path])
            ok("已清理测试对象")
        except Exception as exc:
            print(f"  (cleanup warn: {exc})")

    print(f"\n{GREEN}Phase 4 smoke PASSED{NC}")


if __name__ == "__main__":
    asyncio.run(main())
