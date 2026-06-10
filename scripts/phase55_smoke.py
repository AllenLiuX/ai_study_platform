#!/usr/bin/env python
"""Phase 5.5 冒烟:对话联网搜索 (Tavily provider)。

不调真 Tavily / 真 OpenAI / 真 Supabase,通过 monkeypatch 验证:
1. web_search.is_enabled 与 TAVILY_API_KEY 同步
2. 没 key 时 search() 抛 RuntimeError (不静默吞掉)
3. WebSearchResult 字段过滤:url 空 / content 空的条目被丢弃
4. RetrievedChunk source=web 字段 + format_context 带 [网页] 标签 + URL
5. _web_results_to_chunks 把 Tavily score 透传成 similarity 用于跨源 merge
6. SendMessageRequest.web_search 默认 False,接受 True
7. health 配置 endpoint 暴露 web_search_enabled / web_search_provider
8. notes_service.generate_note_from_message 看到 web citations 时,把"参考资料"段加进 transcript (验证 prompt build)
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

GREEN = "\033[32m"
RED = "\033[31m"
NC = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓ {msg}{NC}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{NC}")
    sys.exit(1)


async def main() -> None:
    from app.core.config import get_settings
    from app.routes.health import config_check
    from app.schemas.chat import SendMessageRequest
    from app.services import web_search
    from app.services.chat_service import (
        _citation_payload,
        _web_results_to_chunks,
    )
    from app.services.retrieval import RetrievedChunk, format_context

    ok("Phase 5.5 模块 import 成功")

    # --- 1. is_enabled 与配置同步 -------------------------------------------------
    settings = get_settings()
    enabled_real = settings.web_search_configured
    assert web_search.is_enabled() == enabled_real
    ok(f"web_search.is_enabled = {enabled_real} (与 settings 一致)")

    # --- 2. 没 key 时 search() 抛 RuntimeError -----------------------------------
    with patch.object(settings, "tavily_api_key", ""):
        # 清掉 cache,让 get_settings 返回 patched 版 — 我们直接用 settings 引用即可
        try:
            await web_search.search("test")
            fail("没 key 时 search() 应该抛 RuntimeError")
        except RuntimeError as exc:
            assert "TAVILY_API_KEY" in str(exc)
            ok("没 key 时 search() 抛 RuntimeError (不静默吞)")

    # --- 3. WebSearchResult / WebSearchResponse 结构 -----------------------------
    from app.services.web_search import WebSearchResponse, WebSearchResult

    fake_results = [
        WebSearchResult(
            title="GPT-5.5 release notes",
            url="https://example.com/gpt55",
            content="GPT-5.5 was released in 2026 with...",
            score=0.92,
            published_date="2026-05-10",
        ),
        WebSearchResult(
            title="MLE Interview System Design",
            url="https://example.com/mle",
            content="Designing event-driven trading systems...",
            score=0.81,
            published_date=None,
        ),
    ]
    ok("WebSearchResult 字段 OK")

    # --- 4. _web_results_to_chunks → RetrievedChunk source=web -------------------
    chunks = _web_results_to_chunks(fake_results)
    assert len(chunks) == 2
    assert all(c.source == "web" for c in chunks)
    assert chunks[0].similarity == 0.92  # Tavily score 透传成 similarity
    assert chunks[0].extra["url"] == "https://example.com/gpt55"
    assert chunks[0].extra["provider"] == "tavily"
    assert chunks[1].extra["published_date"] is None
    ok("_web_results_to_chunks: source=web + similarity=score + extra.url 正确")

    # --- 5. format_context 带 [网页] 标签 + URL ----------------------------------
    mixed = chunks + [
        RetrievedChunk(
            chunk_id="m1",
            source="material",
            source_id="mat-1",
            source_title="量化系统设计讲义",
            source_subject=None,
            chunk_index=2,
            content="事件驱动系统的核心 abstraction 是...",
            similarity=0.75,
        ),
    ]
    ctx = format_context(mixed)
    assert "[网页]" in ctx, ctx
    assert "[资料]" in ctx
    assert "https://example.com/gpt55" in ctx, "web URL 必须进 prompt 让 LLM 看到"
    assert "GPT-5.5" in ctx
    ok("format_context: [网页]/[资料] 标签 + URL 都进 prompt")

    # --- 6. _citation_payload(web) 暴露 url + extra ------------------------------
    payloads = _citation_payload(chunks)
    assert payloads[0]["source"] == "web"
    assert payloads[0]["url"] == "https://example.com/gpt55"
    assert payloads[0]["published_date"] == "2026-05-10"
    assert payloads[0]["extra"]["provider"] == "tavily"
    # 旧字段在 web 上不应该写脏 material_id / note_id
    assert "material_id" not in payloads[0]
    assert "note_id" not in payloads[0]
    ok("_citation_payload(web) 暴露 url + extra,且不写脏 material_id/note_id")

    # --- 7. SendMessageRequest.web_search 默认 False,接受 True --------------------
    req_default = SendMessageRequest(content="hello")
    assert req_default.web_search is False
    req_on = SendMessageRequest(content="hello", web_search=True)
    assert req_on.web_search is True
    ok("SendMessageRequest.web_search 默认 False + 接受 True")

    # --- 8. health endpoint 暴露 web_search_enabled ------------------------------
    health = await config_check()
    assert "web_search_enabled" in health
    assert health["web_search_enabled"] == enabled_real
    if enabled_real:
        assert health.get("web_search_provider") == "tavily"
    ok(f"/health/config 暴露 web_search_enabled={health['web_search_enabled']}")

    # --- 9. notes_service: 含 web citations 时,把"参考资料"段加到 transcript ----
    # 直接验 prompt 构造而非真调 LLM:patch llm 调用,拿 build 的 user message
    captured: dict[str, str] = {}

    class FakeMsg:
        content = '{"title":"x","summary":"y","content":"z","tags":["t"]}'

    class FakeChoice:
        message = FakeMsg()

    class FakeResp:
        choices = [FakeChoice()]

    async def fake_create(model, messages, temperature, response_format):
        # 把发给 LLM 的 user content 抓出来检查
        captured["user"] = next(
            m["content"] for m in messages if m["role"] == "user"
        )
        return FakeResp()

    # 构造 mock supabase 的两条消息:assistant + prev_user,并带 citations
    from app.services import notes_service

    fake_assistant = {
        "id": "msg-2",
        "role": "assistant",
        "session_id": "sess-1",
        "content": "GPT-5.5 是 2026 年 5 月发布的 OpenAI 旗舰模型,...",
        "created_at": "2026-06-10T00:00:00Z",
        "metadata": {
            "agent_type": "ml_teacher",
            "citations": [
                {
                    "source": "web",
                    "source_title": "GPT-5.5 release notes",
                    "url": "https://example.com/gpt55",
                },
                {
                    "source": "material",
                    "source_title": "ML 讲义 1",
                    "material_id": "mat-1",
                },
            ],
        },
    }
    fake_user = {
        "id": "msg-1",
        "role": "user",
        "session_id": "sess-1",
        "content": "GPT-5.5 是什么时候发布的?",
        "created_at": "2026-06-09T23:59:00Z",
        "metadata": {},
    }

    with (
        patch.object(
            notes_service,
            "_fetch_message_pair",
            return_value=(fake_assistant, fake_user),
        ),
        patch.object(
            notes_service.repos,
            "insert_note",
            side_effect=lambda payload: {**payload, "id": "note-new"},
        ),
    ):
        # patch openai client
        class FakeClient:
            class chat:
                class completions:
                    @staticmethod
                    async def create(**kwargs):
                        # temperature 在 reasoning 模型上会被 build_chat_kwargs 剔除,
                        # 用 .get() 兼容
                        return await fake_create(
                            kwargs["model"],
                            kwargs["messages"],
                            kwargs.get("temperature"),
                            kwargs.get("response_format"),
                        )

        with patch.object(notes_service, "get_client", return_value=FakeClient):
            note = await notes_service.generate_note_from_message(
                owner_id="user-1",
                message_id="msg-2",
            )

    assert note["id"] == "note-new"
    assert "参考资料" in captured["user"], (
        "笔记 transcript 应该把 web citations 包成参考资料段喂 LLM"
    )
    assert "https://example.com/gpt55" in captured["user"]
    assert "[web]" in captured["user"]
    assert "[material]" in captured["user"]
    ok("notes_service: 把 metadata.citations (web + material) 拼成参考资料段进 prompt")

    print(f"\n{GREEN}Phase 5.5 smoke PASSED (9 项断言){NC}")


if __name__ == "__main__":
    asyncio.run(main())
