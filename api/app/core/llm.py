"""OpenAI 客户端封装,根据场景选择 default / premium 模型。"""

from __future__ import annotations

from enum import Enum
from typing import AsyncIterator, Iterable

import httpx
from openai import AsyncOpenAI

from .config import get_settings


class ModelTier(str, Enum):
    """模型分级。

    - DEFAULT: 日常对话、轻量提取,使用 gpt-4o-mini
    - PREMIUM: 学习计划、周报告、复杂规划,使用 gpt-4o
    """

    DEFAULT = "default"
    PREMIUM = "premium"


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """返回 OpenAI 异步客户端 (单例)。

    显式注入一个 `trust_env=False` 的 httpx client,避免在带本地代理的开发环境
    (例如 ByteDance 的 127.0.0.1:55140) 下被代理拦截。OpenAI 是公网服务,直连即可。
    """
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            http_client=httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(60.0)),
        )
    return _client


def resolve_model(tier: ModelTier = ModelTier.DEFAULT) -> str:
    settings = get_settings()
    if tier == ModelTier.PREMIUM:
        return settings.openai_chat_model_premium
    return settings.openai_chat_model_default


async def stream_chat(
    messages: Iterable[dict[str, str]],
    *,
    tier: ModelTier = ModelTier.DEFAULT,
    temperature: float = 0.5,
) -> AsyncIterator[str]:
    """以流的方式调用 OpenAI Chat Completions,yield 文本增量。"""
    client = get_client()
    model = resolve_model(tier)
    stream = await client.chat.completions.create(
        model=model,
        messages=list(messages),
        temperature=temperature,
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield text


async def complete_chat(
    messages: Iterable[dict[str, str]],
    *,
    tier: ModelTier = ModelTier.DEFAULT,
    temperature: float = 0.5,
) -> str:
    """非流式调用,返回完整文本。"""
    client = get_client()
    model = resolve_model(tier)
    resp = await client.chat.completions.create(
        model=model,
        messages=list(messages),
        temperature=temperature,
    )
    return resp.choices[0].message.content or ""
