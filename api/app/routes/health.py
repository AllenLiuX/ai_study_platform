"""健康检查与配置自检。"""

from __future__ import annotations

from fastapi import APIRouter

from ..core.config import get_settings
from ..core.llm import DEFAULT_TIER, list_tiers, resolve_model

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/health/config")
async def config_check() -> dict:
    """暴露当前环境配置是否齐全 (不返回真实 key)。"""
    settings = get_settings()
    return {
        "openai_configured": bool(settings.openai_api_key)
        and not settings.openai_api_key.startswith("sk-proj-xxx"),
        "supabase_configured": settings.supabase_configured,
        # Phase 5.5: 对话联网搜索是否可用 (前端 Globe toggle 用这个决定 disabled 态)
        "web_search_enabled": settings.web_search_configured,
        "web_search_provider": "tavily" if settings.web_search_configured else None,
        # 历史字段 (保持兼容,前端 Dashboard 用)
        "models": {
            "default": resolve_model("medium"),
            "premium": resolve_model("high"),
            "embedding": settings.openai_embedding_model,
        },
        # Phase 3.5: 5 档模型完整列表 + 默认 tier,前端 ModelSelector 用
        "model_tiers": list_tiers(),
        "default_tier": DEFAULT_TIER.value,
        "cors_origins": settings.cors_origins_list,
    }
