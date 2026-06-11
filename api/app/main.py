"""FastAPI 应用入口。"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .routes import agents as agents_route
from .routes import chat as chat_route
from .routes import health as health_route
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

    return app


app = create_app()
