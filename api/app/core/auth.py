"""Supabase JWT 验证 middleware。

Phase 0 采用 `supabase-py` 自带的 `auth.get_user(jwt)` 校验:
- 内部仍然调 Supabase Auth `/user` 接口,但用 supabase-py 已经调好的 httpx 配置
  (在带本地代理的开发环境下比裸 httpx 兼容性更好)
- 失败会抛 `AuthApiError`,可统一捕获并映射为 401/503

后续若需要更高 QPS,可切换到本地 JWKS 验签,见
https://supabase.com/docs/guides/auth/auth-helpers/backend-jwts
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

from fastapi import Depends, HTTPException, Request, status
from supabase import Client, create_client

from .config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    raw_metadata: dict


@lru_cache(maxsize=1)
def _get_auth_client() -> Client:
    """单独创建一个 anon-role 的 supabase client 用于校验用户 JWT。

    注意:不要和服务端的 admin client (service_role) 共用同一个实例,
    因为 `auth.get_user(jwt)` 需要用 JWT 而非 service_role 调用。
    """
    settings = get_settings()
    if not settings.supabase_configured:
        raise RuntimeError(
            "Supabase 尚未配置,请在 .env 中填好 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(settings.supabase_url, settings.supabase_anon_key)


async def _verify_with_supabase(access_token: str) -> CurrentUser:
    settings = get_settings()
    if not settings.supabase_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase 尚未配置,请填入 .env 后重启后端",
        )

    try:
        client = _get_auth_client()
        resp = client.auth.get_user(access_token)
    except Exception as exc:  # 包含 AuthApiError / 网络异常
        msg = str(exc).lower()
        if "invalid" in msg or "expired" in msg or "jwt" in msg or "unauthor" in msg:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="无效或过期的 token",
            ) from exc
        logger.exception("Supabase auth request failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Auth 服务不可用: {exc}",
        ) from exc

    if not resp or not resp.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效或过期的 token",
        )

    user = resp.user
    return CurrentUser(
        id=user.id,
        email=user.email,
        raw_metadata=user.user_metadata or {},
    )


async def get_current_user(request: Request) -> CurrentUser:
    """FastAPI 依赖:解析 Authorization header 并验证。"""
    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 Authorization Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 为空"
        )
    return await _verify_with_supabase(token)


CurrentUserDep = Depends(get_current_user)
