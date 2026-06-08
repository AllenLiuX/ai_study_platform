"""健康检查与配置自检。"""

from __future__ import annotations

from fastapi import APIRouter

from ..core.config import get_settings

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
        "models": {
            "default": settings.openai_chat_model_default,
            "premium": settings.openai_chat_model_premium,
            "embedding": settings.openai_embedding_model,
        },
        "cors_origins": settings.cors_origins_list,
    }
