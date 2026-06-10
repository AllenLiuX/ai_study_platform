"""Phase 5.5: 对话联网搜索 (Tavily provider)。

设计原则:
- 显式触发:学生在 ChatInput 上 toggle 「🌐 联网搜索」,后端只在 toggle ON 时调
- Provider 解耦:对外只暴露 `is_enabled` / `search`,future 切到 Brave/SerpAPI
  / OpenAI Responses 内置 `web_search` tool 也只需要换 impl
- 结果 → `RetrievedChunk(source="web")`,与 materials/notes 同一条 RAG pipeline
- 韧性:没 key / 网络挂 / 超时 → 返回空 list + warning,不阻塞主回答

Tavily docs: https://docs.tavily.com/docs/rest-api/api-reference

成本参考:Tavily basic ≈ $0.005/搜索,advanced ≈ $0.04/搜索;免费 tier 1000/月。
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

import httpx

from ..core.config import get_settings

logger = logging.getLogger(__name__)

TAVILY_ENDPOINT = "https://api.tavily.com/search"

# 调用本身的超时;再加上 chat_service 里的总 wait_for 兜底
_HTTP_TIMEOUT = 12.0


SearchDepth = Literal["basic", "advanced"]


@dataclass(slots=True)
class WebSearchResult:
    """一条网络搜索结果。

    score: Tavily 给的 relevance 0-1,越高越相关;后续可以参与 merge 排序
    published_date: 不一定有 (Tavily 会尝试解析)
    """

    title: str
    url: str
    content: str  # 已经是 markdown-friendly snippet,可直接塞 prompt
    score: float
    published_date: str | None = None


@dataclass(slots=True)
class WebSearchResponse:
    """整次搜索的元信息 + 结果。"""

    query: str
    results: list[WebSearchResult]
    response_time_ms: int


def is_enabled() -> bool:
    """前端 toggle 是否应该亮:仅当后端配了 TAVILY_API_KEY。"""
    return get_settings().web_search_configured


async def search(
    query: str,
    *,
    max_results: int | None = None,
    depth: SearchDepth | None = None,
) -> WebSearchResponse:
    """对外暴露的统一接口。"""
    settings = get_settings()
    if not settings.web_search_configured:
        raise RuntimeError("TAVILY_API_KEY 未配置,无法联网搜索")
    cleaned = (query or "").strip()
    if not cleaned:
        return WebSearchResponse(query="", results=[], response_time_ms=0)
    if len(cleaned) > 400:
        cleaned = cleaned[:400]

    payload = {
        "api_key": settings.tavily_api_key,
        "query": cleaned,
        "search_depth": depth or settings.tavily_search_depth or "basic",
        "max_results": max_results or settings.tavily_max_results or 5,
        "include_answer": False,  # 我们要原始结果而不是 Tavily 的摘要,把推理留给主 LLM
        "include_raw_content": False,
        "include_images": False,
    }

    try:
        async with httpx.AsyncClient(
            timeout=_HTTP_TIMEOUT, trust_env=True
        ) as client:
            resp = await client.post(TAVILY_ENDPOINT, json=payload)
    except httpx.TimeoutException as exc:
        logger.warning("tavily search timeout: %s", exc)
        raise RuntimeError(f"联网搜索超时 ({_HTTP_TIMEOUT}s)") from exc
    except httpx.HTTPError as exc:
        logger.warning("tavily search http error: %s", exc)
        raise RuntimeError(f"联网搜索网络错误: {exc}") from exc

    if resp.status_code != 200:
        # Tavily 401 / 432 / 429 等
        try:
            body = resp.json()
        except Exception:
            body = {"detail": resp.text[:200]}
        msg = body.get("detail") or body.get("error") or str(body)
        raise RuntimeError(f"联网搜索失败 ({resp.status_code}): {msg}")

    data = resp.json() or {}
    raw_results = data.get("results") or []
    elapsed_s = float(data.get("response_time") or 0.0)
    results: list[WebSearchResult] = []
    for r in raw_results:
        url = (r.get("url") or "").strip()
        title = (r.get("title") or url or "(无标题)").strip()
        content = (r.get("content") or "").strip()
        if not url or not content:
            continue
        try:
            score = float(r.get("score") or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        results.append(
            WebSearchResult(
                title=title[:200],
                url=url,
                content=content,
                score=max(0.0, min(score, 1.0)),
                published_date=r.get("published_date") or None,
            )
        )

    return WebSearchResponse(
        query=cleaned,
        results=results,
        response_time_ms=int(elapsed_s * 1000),
    )


async def search_with_timeout(
    query: str,
    *,
    max_results: int | None = None,
    depth: SearchDepth | None = None,
    total_timeout_s: float = 15.0,
) -> WebSearchResponse:
    """带总超时的包装:防止 LLM 主回答被卡住。"""
    try:
        return await asyncio.wait_for(
            search(query, max_results=max_results, depth=depth),
            timeout=total_timeout_s,
        )
    except asyncio.TimeoutError as exc:
        raise RuntimeError(
            f"联网搜索整体超时 ({total_timeout_s}s),本次跳过搜索"
        ) from exc
