"""Phase 5: 自定义老师 (user_agents) CRUD 路由。"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from openai import APIError as OpenAIAPIError

from ..core.auth import CurrentUser, get_current_user
from ..core.llm import ModelTier, build_chat_kwargs, get_client, resolve_model
from ..db import repos
from ..schemas.agent import (
    CreateUserAgentRequest,
    GenerateAgentSpecRequest,
    GeneratedAgentSpec,
    UpdateUserAgentRequest,
    UserAgent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

_RESERVED_KEYS = {
    "head_teacher",
    "math_teacher",
    "english_teacher",
    "chinese_teacher",
}


def _to_user_agent(row: dict) -> UserAgent:
    return UserAgent(
        id=row["id"],
        owner_type=row["owner_type"],
        owner_id=row.get("owner_id"),
        agent_key=row["agent_key"],
        display_name=row.get("display_name") or row["agent_key"],
        emoji=row.get("emoji") or "🎓",
        tagline=row.get("tagline"),
        role=row.get("role"),
        system_prompt=row.get("system_prompt"),
        starter_prompts=list(row.get("starter_prompts") or []),
        default_material_ids=list(row.get("default_material_ids") or []),
        domains=list(row.get("domains") or []),
        default_model_tier=row.get("default_model_tier") or "medium",
        subject_id=row.get("subject_id"),
        is_active=bool(row.get("is_active", True)),
        is_public=bool(row.get("is_public", False)),
        clone_count=int(row.get("clone_count") or 0),
        author_name=row.get("author_name"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=list[UserAgent])
async def list_agents(user: CurrentUser = Depends(get_current_user)) -> list[UserAgent]:
    """列出当前用户可见的所有老师 (4 个平台老师 + 用户自己的私有老师)。"""
    rows = repos.list_user_agents(user.id)
    return [_to_user_agent(r) for r in rows]


@router.get("/public", response_model=list[UserAgent])
async def list_public_agents(
    q: str | None = None,
    user: CurrentUser = Depends(get_current_user),
) -> list[UserAgent]:
    """发现页：其他用户公开分享的老师。"""
    rows = repos.list_public_agents(q=q)
    return [_to_user_agent(r) for r in rows]


@router.post("/{source_id}/clone", response_model=UserAgent, status_code=201)
async def clone_agent(
    source_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> UserAgent:
    """把一个公开老师「添加到我的老师」= 克隆一份到自己名下。"""
    row = repos.clone_public_agent(viewer_id=user.id, source_id=source_id)
    if not row:
        raise HTTPException(status_code=404, detail="老师不存在或未公开")
    return _to_user_agent(row)


@router.get("/{agent_key}", response_model=UserAgent)
async def get_agent_detail(
    agent_key: str,
    user: CurrentUser = Depends(get_current_user),
) -> UserAgent:
    row = repos.get_user_agent_by_key(agent_key, owner_id=user.id)
    if not row:
        raise HTTPException(status_code=404, detail="老师不存在或无权访问")
    return _to_user_agent(row)


@router.post("", response_model=UserAgent, status_code=201)
async def create_agent(
    payload: CreateUserAgentRequest,
    user: CurrentUser = Depends(get_current_user),
) -> UserAgent:
    """学生 / 自由学习者创建私有老师。"""
    # 防撞 platform 保留 key (schema 也校验过,这里再 belt-and-suspenders)
    if payload.agent_key in _RESERVED_KEYS:
        raise HTTPException(status_code=400, detail="该 agent_key 是平台保留名")

    existing = repos.get_user_agent_by_key(payload.agent_key, owner_id=None)
    if existing is not None:
        raise HTTPException(status_code=409, detail="agent_key 已被使用,请换一个")

    db_payload = {
        "agent_key": payload.agent_key,
        "display_name": payload.display_name,
        "emoji": payload.emoji or "🎓",
        "tagline": payload.tagline,
        "role": payload.role,
        "system_prompt": payload.system_prompt,
        "starter_prompts": payload.starter_prompts,
        "default_material_ids": payload.default_material_ids,
        "domains": payload.domains,
        "default_model_tier": payload.default_model_tier,
        "subject_id": payload.subject_id,
        "is_public": payload.is_public,
    }
    try:
        row = repos.create_user_agent(owner_id=user.id, payload=db_payload)
    except Exception as exc:
        logger.exception("create_user_agent failed")
        raise HTTPException(status_code=500, detail=f"创建失败: {exc}") from exc
    return _to_user_agent(row)


@router.patch("/{agent_key}", response_model=UserAgent)
async def update_agent(
    agent_key: str,
    payload: UpdateUserAgentRequest,
    user: CurrentUser = Depends(get_current_user),
) -> UserAgent:
    if agent_key in _RESERVED_KEYS:
        raise HTTPException(status_code=403, detail="平台老师不可编辑")

    fields = payload.to_db_fields()
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    row = repos.update_user_agent(
        agent_key=agent_key, owner_id=user.id, fields=fields
    )
    if not row:
        raise HTTPException(status_code=404, detail="老师不存在或无权编辑")
    return _to_user_agent(row)


@router.delete("/{agent_key}", status_code=204)
async def delete_agent(
    agent_key: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    if agent_key in _RESERVED_KEYS:
        raise HTTPException(status_code=403, detail="平台老师不可删除")
    ok = repos.delete_user_agent(agent_key=agent_key, owner_id=user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="老师不存在或无权删除")


# -----------------------------------------------------------------------------
# 创建老师辅助:用一段自然语言描述,LLM 帮忙补全 system_prompt / starter_prompts 等
# 用 MEDIUM 档,非流式 (前端转圈即可)
# -----------------------------------------------------------------------------
_GEN_AGENT_SYSTEM = """你是一个 AI 学习平台的"老师创建助手"。
学生会给你一段对自己学习目标的描述,你要帮 ta 配置一个"老师" Agent (system prompt + 元数据)。
请严格输出一个 JSON 对象,字段包括:
- agent_key (老师的英文唯一标识,**只能用 a-z / 0-9 / 下划线**,4-30 字符,要 reflect 老师的方向,
  例如 "quant_system_design" / "beauty_livestream_coach" / "ml_interview_mentor" /
  "react_frontend_tutor"。即使用户描述是中文,也要起一个英文 slug。**不要**用 "head_teacher"
  / "math_teacher" / "english_teacher" / "chinese_teacher" 这 4 个平台保留名。)
- display_name (10 字以内,体现专业方向,可以是中文)
- emoji (单个 emoji,与方向匹配)
- tagline (一句话简介,20 字以内)
- role (老师定位,例如:"算法系统设计 / 面试辅导")
- system_prompt (一段完整的中文 system prompt,告诉老师如何辅导学生;要包含:专业范围 / 教学风格 / 如何拆解知识点 / 鼓励学生独立思考 / 如何引用资料 / 如何主动小步推进。≥ 200 字 ≤ 1500 字)
- starter_prompts (3 个用户可能问的开场问题,具体到方向,不要空洞)
- domains (这位老师覆盖的领域 tags,3-6 个)
- suggested_model_tier (推荐档位 low/medium/high/extra_high/max,默认 medium;若涉及代码/系统设计/算法证明可用 high)

只输出 JSON,不要解释,不要 markdown 代码块包裹。"""

_AGENT_KEY_OK_RE = re.compile(r"^[a-z0-9_\-]{2,64}$")


def _sanitize_agent_key(raw: str | None, *, display_name: str = "") -> str:
    """把 LLM 输出的 agent_key 规范化:
    - 全转 lowercase
    - 中文 / 特殊字符过滤掉
    - 多空白 / 连续下划线压缩成单下划线
    - 撞保留名时加 _v2 后缀
    - 校验不通过时回落到 display_name 转 + 时间戳
    """
    raw = (raw or "").strip().lower()
    # 把 NBSP / 中文空格当成空格,然后空格转下划线
    cleaned = re.sub(r"[^a-z0-9_\-]+", "_", raw).strip("_-")
    cleaned = re.sub(r"_+", "_", cleaned)[:60]

    if cleaned and _AGENT_KEY_OK_RE.match(cleaned) and cleaned not in _RESERVED_KEYS:
        return cleaned

    # display_name 兜底 (英文场景才有用)
    fallback = re.sub(r"[^a-z0-9_\-]+", "_", display_name.lower()).strip("_-")[:40]
    if fallback and _AGENT_KEY_OK_RE.match(fallback) and fallback not in _RESERVED_KEYS:
        return fallback

    # 最终兜底:u-<时间戳后 6 位>,保证全局可用
    import time

    return f"u_{int(time.time()) % 1_000_000:06d}"


def _safe_load_json(text: str) -> dict[str, Any]:
    text = text.strip()
    # 兼容 ```json ... ``` 包裹
    fence_match = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, flags=re.S | re.I)
    if fence_match:
        text = fence_match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 尝试找到第一个 { 和最后一个 }
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


@router.post("/_generate", response_model=GeneratedAgentSpec)
async def generate_agent_spec(
    payload: GenerateAgentSpecRequest = Body(...),
    user: CurrentUser = Depends(get_current_user),
) -> GeneratedAgentSpec:
    """让 LLM 帮学生从描述生成老师配置 (用户在 /agents/new 上点'AI 帮我生成')。"""
    domains_hint = (
        f"\n\n用户已选关注领域:{', '.join(payload.domains)}"
        if payload.domains
        else ""
    )
    user_msg = f"我想配一个老师,描述如下:\n\n{payload.description}{domains_hint}"

    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": _GEN_AGENT_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.5,
                response_format={"type": "json_object"},
            ),
        )
    except OpenAIAPIError as exc:
        logger.warning("generate agent spec failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {exc}") from exc

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("LLM 输出无法解析为 JSON: %s\n%s", exc, text[:500])
        raise HTTPException(status_code=502, detail="LLM 输出格式异常,请重试") from exc

    # 落入 Pydantic 做最终校验
    display_name = str(data.get("display_name") or "")[:64].strip() or "新的老师"
    try:
        spec = GeneratedAgentSpec(
            agent_key=_sanitize_agent_key(
                str(data.get("agent_key") or ""), display_name=display_name
            ),
            display_name=display_name,
            emoji=str(data.get("emoji") or "🎓")[:8],
            tagline=str(data.get("tagline") or "")[:200],
            role=str(data.get("role") or "")[:80],
            system_prompt=str(data.get("system_prompt") or "").strip(),
            starter_prompts=[
                str(p).strip()
                for p in (data.get("starter_prompts") or [])[:6]
                if str(p).strip()
            ],
            domains=[
                str(d).strip() for d in (data.get("domains") or [])[:10] if str(d).strip()
            ],
            suggested_model_tier=(
                data.get("suggested_model_tier")
                if data.get("suggested_model_tier") in {"low", "medium", "high", "extra_high", "max"}
                else "medium"
            ),
        )
    except Exception as exc:
        logger.warning("LLM 输出校验失败: %s\n%s", exc, data)
        raise HTTPException(status_code=502, detail=f"LLM 输出格式异常: {exc}") from exc

    if len(spec.system_prompt) < 50:
        raise HTTPException(status_code=502, detail="LLM 输出 system_prompt 过短,请重试")
    return spec
