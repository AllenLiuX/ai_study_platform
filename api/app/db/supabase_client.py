"""后端使用 service role key 访问 Supabase。

注意:service role key 会绕过 RLS,只允许在受信的服务端使用。
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from ..core.config import get_settings


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """返回带 service role 权限的 Supabase 客户端 (单例)。"""
    settings = get_settings()
    if not settings.supabase_configured:
        raise RuntimeError(
            "Supabase 配置缺失,请在 .env 中填好 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
