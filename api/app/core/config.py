"""统一读取根目录 .env 的配置。"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    # ------- 历史字段 (向后兼容,Phase 3.5 之后用 5 档替代) -------
    openai_chat_model_default: str = Field(
        default="gpt-4o-mini", alias="OPENAI_CHAT_MODEL_DEFAULT"
    )
    openai_chat_model_premium: str = Field(
        default="gpt-4o", alias="OPENAI_CHAT_MODEL_PREMIUM"
    )
    openai_embedding_model: str = Field(
        default="text-embedding-3-small", alias="OPENAI_EMBEDDING_MODEL"
    )

    # ------- Phase 3.5: 5 档模型(用户可在对话中现选)-------
    # 默认 medium = default,high = premium,保证旧 .env 不改也能跑;
    # 想用 o3-mini / o1 等推理模型,设对应 env 即可。
    openai_chat_model_low: str = Field(default="", alias="OPENAI_CHAT_MODEL_LOW")
    openai_chat_model_medium: str = Field(default="", alias="OPENAI_CHAT_MODEL_MEDIUM")
    openai_chat_model_high: str = Field(default="", alias="OPENAI_CHAT_MODEL_HIGH")
    openai_chat_model_extra_high: str = Field(
        default="", alias="OPENAI_CHAT_MODEL_EXTRA_HIGH"
    )
    openai_chat_model_max: str = Field(default="", alias="OPENAI_CHAT_MODEL_MAX")

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(
        default="", alias="SUPABASE_SERVICE_ROLE_KEY"
    )

    backend_cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="BACKEND_CORS_ORIGINS",
    )
    # 用于匹配 Vercel preview / 通配子域名等动态 origin,默认空 = 不启用
    # 例:^https://ai-study-platform[a-z0-9-]*\.vercel\.app$
    backend_cors_origin_regex: str = Field(
        default="", alias="BACKEND_CORS_ORIGIN_REGEX"
    )
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.backend_cors_origins.split(",")
            if origin.strip()
        ]

    @property
    def cors_origin_regex(self) -> str | None:
        return self.backend_cors_origin_regex.strip() or None

    @property
    def supabase_configured(self) -> bool:
        return (
            bool(self.supabase_url)
            and not self.supabase_url.startswith("https://your-project-ref")
            and bool(self.supabase_service_role_key)
            and not self.supabase_service_role_key.startswith("PLACEHOLDER")
        )


def _ensure_no_proxy(settings: Settings) -> None:
    """把 Supabase / OpenAI 加入 NO_PROXY,绕过本地企业代理。

    背景:有些开发环境(例如字节内网)默认设了 HTTP(S)_PROXY 指向 127.0.0.1:xxx
    并对 supabase.co / api.openai.com 返回 403。supabase-py 内部 httpx 不可注入
    自定义 client,但它默认 trust_env=True,所以能尊重 NO_PROXY。这里在配置初始化时
    把直连服务追加进去,前端和后端的 httpx.Client(trust_env=True) 都会自动绕过代理。
    """
    extras: list[str] = ["api.openai.com", "files.openai.com", "openai.com"]
    if settings.supabase_url:
        host = urlparse(settings.supabase_url).hostname
        if host:
            extras.append(host)
            # storage / realtime 也跟 project 同域,顺手加上
            extras.append(f".{host.split('.', 1)[1]}" if "." in host else host)

    seen: set[str] = set()
    for key in ("NO_PROXY", "no_proxy"):
        for p in (os.environ.get(key) or "").split(","):
            p = p.strip()
            if p:
                seen.add(p)
    seen.update(extras)
    merged = ",".join(sorted(seen))
    os.environ["NO_PROXY"] = merged
    os.environ["no_proxy"] = merged


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    _ensure_no_proxy(settings)
    return settings
