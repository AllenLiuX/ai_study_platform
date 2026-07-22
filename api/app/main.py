"""FastAPI 应用入口。"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import get_settings
from .routes import agents as agents_route
from .routes import chat as chat_route
from .routes import groups as groups_route
from .routes import health as health_route
from .routes import lecture as lecture_route
from .routes import materials as materials_route
from .routes import notes as notes_route
from .routes import practice as practice_route
from .routes import students as students_route


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    app = FastAPI(
        title="学生学习驾驶舱 API",
        description="面向中国初高中学生的 AI 学习平台后端",
        version="0.1.0",
    )

    cors_kwargs: dict = {
        "allow_origins": settings.cors_origins_list,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if settings.cors_origin_regex:
        # FastAPI 的 CORSMiddleware 同时支持 allow_origins 和 allow_origin_regex
        # 任一匹配即放行;用于 Vercel preview 这种 *.vercel.app 动态域名
        cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    app.include_router(health_route.router)
    app.include_router(students_route.router, prefix="/api")
    app.include_router(chat_route.router, prefix="/api")
    app.include_router(materials_route.router, prefix="/api")
    app.include_router(agents_route.router, prefix="/api")
    app.include_router(notes_route.router, prefix="/api")
    app.include_router(practice_route.router, prefix="/api")
    app.include_router(lecture_route.router, prefix="/api")
    app.include_router(groups_route.router, prefix="/api")

    # 全局兜底: 未捕获异常 (含 postgrest APIError / 数据库表缺失等) 走这里,
    # 返回 JSON + CORS 头, 前端能拿到人话错误 (否则浏览器只显示 "Failed to fetch")
    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception):
        logging.getLogger("app.errors").exception(
            "unhandled exception on %s %s", request.method, request.url.path
        )
        # 特殊识别常见"数据库还没迁移"错误, 给可行动的提示
        msg = str(exc) or exc.__class__.__name__
        detail = f"服务异常: {msg}"
        if "PGRST205" in msg or "schema cache" in msg:
            detail = (
                "数据库表不存在, 需要跑最新的 supabase/migrations/*.sql "
                "(去 Supabase SQL Editor 执行)"
            )
        return JSONResponse(status_code=500, content={"detail": detail})

    return app


app = create_app()
