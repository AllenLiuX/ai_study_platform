"""Chat 业务层:粘合 agent runtime 与数据库。"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import AsyncIterator

from fastapi import BackgroundTasks, HTTPException, status

from ..agents.registry import AgentConfig, resolve_agent
from ..agents.runtime import stream_reply
from ..core.llm import ModelTier, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client
from ..schemas.chat import CreateSessionRequest
from .progress_extractor import extract_and_update
from .retrieval import RetrievedChunk, format_context, retrieve_for_chat
from .suggester import suggest_follow_ups
from . import web_search as web_search_svc

logger = logging.getLogger(__name__)

# Phase 4: 拼 OpenAI vision data URL 用
_CHAT_BUCKET = "chat-attachments"
_MIME_BY_EXT = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


async def _load_attachment_data_url(storage_path: str) -> str | None:
    """从 chat-attachments bucket 拉对象,转 data:image/...;base64,xxx URL。

    OpenAI vision 接受这种 inline data URL,免去把 storage 暴露成 public URL。
    失败返回 None(让上层跳过,不打断对话)。
    """
    client = get_admin_client()
    try:
        data = await asyncio.to_thread(
            lambda: client.storage.from_(_CHAT_BUCKET).download(storage_path)
        )
    except Exception as exc:
        logger.warning("load attachment failed: %s (%s)", storage_path, exc)
        return None
    if not data:
        return None
    ext = storage_path.rsplit(".", 1)[-1].lower() if "." in storage_path else "png"
    mime = _MIME_BY_EXT.get(ext, "image/png")
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


async def _enrich_history_with_images(history: list[dict]) -> list[dict]:
    """对 history 中每条带 metadata.image_urls 的 user msg,挂上临时字段
    `_image_data_urls`(base64 data URL 列表)。返回新 list,不改原对象。

    多轮对话里历史图片也会被一并 base64,确保模型在第 N 轮提问时还"看得见"
    之前贴的题目。生产中如果想压缩开销,可改成仅最近 K 条带图。
    """
    cache: dict[str, str | None] = {}
    out: list[dict] = []
    for msg in history:
        m = dict(msg)
        md = m.get("metadata") or {}
        paths = md.get("image_urls") or []
        if paths and m.get("role") == "user":
            data_urls: list[str] = []
            for p in paths:
                if p not in cache:
                    cache[p] = await _load_attachment_data_url(p)
                if cache[p]:
                    data_urls.append(cache[p])  # type: ignore[arg-type]
            if data_urls:
                m["_image_data_urls"] = data_urls
        out.append(m)
    return out


def _default_session_title(agent: AgentConfig) -> str:
    return f"{agent.display_name} 的对话"


def create_chat_session(*, user_id: str, payload: CreateSessionRequest) -> dict:
    try:
        agent = resolve_agent(payload.agent_type, owner_id=user_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    title = payload.title or _default_session_title(agent)
    subject_id = payload.subject_id or agent.subject_id
    session = repos.create_session(
        student_id=user_id,
        agent_type=agent.agent_type,
        subject_id=subject_id,
        title=title,
    )

    if agent.welcome_message:
        repos.insert_message(
            session_id=session["id"],
            role="assistant",
            content=agent.welcome_message,
            metadata={"kind": "welcome"},
        )
    return session


def get_session_or_404(session_id: str, user_id: str) -> dict:
    session = repos.get_session(session_id, user_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在或无权访问",
        )
    return session


def list_messages(session_id: str, user_id: str) -> list[dict]:
    get_session_or_404(session_id, user_id)
    return repos.list_messages(session_id)


def list_sessions(user_id: str) -> list[dict]:
    return repos.list_sessions(user_id)


def _citation_payload(chunks: list[RetrievedChunk]) -> list[dict]:
    """前端可消费的引用条目。

    Phase 5: 同时含 material / note 来源,前端 ChatWindow 用 `source` 区分图标。
    Phase 5.5: 新增 `source="web"` (Tavily 联网搜索),extra 里带 url。
    保留 material_id / material_title 旧字段以兼容老消息渲染。
    """
    out: list[dict] = []
    for c in chunks:
        item = {
            "source": c.source,  # "material" | "note" | "web"
            "source_id": c.source_id,
            "source_title": c.source_title,
            "chunk_index": c.chunk_index,
            "similarity": round(c.similarity, 4),
            "snippet": c.content[:200],
        }
        # 旧字段兼容
        if c.source == "material":
            item["material_id"] = c.source_id
            item["material_title"] = c.source_title
        elif c.source == "note":
            item["note_id"] = c.source_id
            item["note_title"] = c.source_title
        elif c.source == "web":
            extra = c.extra or {}
            item["url"] = extra.get("url") or c.source_id
            if extra.get("published_date"):
                item["published_date"] = extra["published_date"]
        if c.extra:
            # Tavily score / 笔记 tags / 等保留在 extra,前端可选展示
            item["extra"] = c.extra
        out.append(item)
    return out


def _web_results_to_chunks(
    results,  # list[WebSearchResult]
) -> list[RetrievedChunk]:
    """把 Tavily 结果包成统一的 RetrievedChunk(source=web),
    后续 format_context / citation 全走同一条 pipeline。
    """
    chunks: list[RetrievedChunk] = []
    for i, r in enumerate(results):
        chunks.append(
            RetrievedChunk(
                chunk_id=f"web:{i}",
                source="web",
                source_id=r.url,
                source_title=r.title,
                source_subject=None,
                chunk_index=i,
                # Tavily content 已经是 snippet,塞 prompt 安全
                content=r.content,
                similarity=float(r.score),
                extra={
                    "url": r.url,
                    "published_date": r.published_date,
                    "provider": "tavily",
                },
            )
        )
    return chunks


async def stream_assistant_reply(
    *,
    session_id: str,
    user_id: str,
    user_content: str,
    material_ids: list[str] | None,
    student_profile: dict | None,
    background_tasks: BackgroundTasks | None = None,
    model_tier: str | None = None,
    image_urls: list[str] | None = None,
    web_search: bool = False,
) -> AsyncIterator[str]:
    """流式生成 assistant 回复。

    yield 出去的是 SSE event 字符串(已经包含 `event: ...\\ndata: ...\\n\\n`)。

    流程:
    1. 校验会话归属
    2. 落库 user message (在 metadata.material_ids 中标注引用了哪些资料)
    3. 取历史
    4. 若提供 material_ids,做 RAG 召回 → 发送 citations 事件
    5. 调 LLM stream
    6. 累计完整文本后落库 assistant message,citations 写入 metadata
    """
    session = get_session_or_404(session_id, user_id)
    agent = resolve_agent(session["agent_type"], owner_id=user_id)

    user_meta: dict = {}
    if material_ids:
        user_meta["material_ids"] = material_ids
    if image_urls:
        # 校验图片归属:必须以 <user_id>/ 起头,防有人猜路径
        user_meta["image_urls"] = [
            p for p in image_urls if isinstance(p, str) and p.startswith(f"{user_id}/")
        ]
    # Phase 5.5: 学生显式开了联网搜索 toggle,落库标记一下,便于回看 / 审计
    if web_search:
        user_meta["web_search"] = True
    # 纯图无文字时给个占位 — chat_messages.content 是 NOT NULL,且前端做了
    # 默认占位,这里再兜一道,避免边角 case 触发 db 校验失败
    safe_content = user_content
    if not (safe_content and safe_content.strip()) and user_meta.get("image_urls"):
        safe_content = "（图片）"
    repos.insert_message(
        session_id=session_id,
        role="user",
        content=safe_content,
        metadata=user_meta or None,
    )

    raw_history = repos.list_messages(session_id)
    # 多模态历史:有图片的 user msg 挂上 base64 data URL,后续 build_messages 用得到
    history = await _enrich_history_with_images(raw_history)

    assistant_text_parts: list[str] = []
    citations: list[RetrievedChunk] = []
    # Phase 3.5: 学生临时选择的 tier 优先,否则用 agent 默认
    try:
        effective_tier: ModelTier = (
            ModelTier(model_tier) if model_tier else agent.tier
        )
    except ValueError:
        logger.warning("非法 model_tier=%s,回落到 agent 默认", model_tier)
        effective_tier = agent.tier
    try:
        model_name = resolve_model(effective_tier)
        yield _sse(
            "ready",
            {
                "agent_type": agent.agent_type,
                "model": model_name,
                "model_tier": effective_tier.value,
                "agent": {
                    "agent_key": agent.agent_type,
                    "display_name": agent.display_name,
                    "emoji": agent.emoji,
                    "owner_type": agent.owner_type,
                    "default_material_ids": list(agent.default_material_ids),
                },
            },
        )

        rag_context: str | None = None
        # Phase 5: 总是尝试召回笔记 (用户私有 KP);material_ids 显式空时仍只走笔记
        has_materials = material_ids is not None and len(material_ids) > 0

        # Phase 5.5: 联网搜索 — 仅 toggle ON + 后端配了 key + 文字 query 非空 才走
        web_chunks: list[RetrievedChunk] = []
        if web_search and user_content.strip():
            if not web_search_svc.is_enabled():
                yield _sse(
                    "warning",
                    {
                        "message": "联网搜索未在后端启用 (缺少 TAVILY_API_KEY),本次回退到本地 RAG"
                    },
                )
            else:
                yield _sse(
                    "web_search",
                    {"status": "searching", "query": user_content[:200]},
                )
                try:
                    ws = await web_search_svc.search_with_timeout(
                        user_content, total_timeout_s=15.0
                    )
                    web_chunks = _web_results_to_chunks(ws.results)
                    yield _sse(
                        "web_search",
                        {
                            "status": "done",
                            "count": len(ws.results),
                            "query": ws.query,
                            "response_time_ms": ws.response_time_ms,
                            "results": [
                                {
                                    "title": r.title,
                                    "url": r.url,
                                    "snippet": r.content[:200],
                                    "score": round(r.score, 4),
                                    "published_date": r.published_date,
                                }
                                for r in ws.results
                            ],
                        },
                    )
                except Exception as exc:
                    logger.warning("web search failed: %s", exc)
                    yield _sse(
                        "web_search",
                        {"status": "error", "message": str(exc)},
                    )

        try:
            local_chunks = await retrieve_for_chat(
                query=user_content,
                owner_id=user_id,
                material_ids=material_ids if has_materials else None,
                include_notes=True,
                top_k_materials=5,
                top_k_notes=3,
            )
        except Exception as exc:
            logger.warning("RAG retrieval failed: %s", exc)
            yield _sse(
                "warning",
                {"message": f"资料/笔记检索失败,本次将基于通识知识回答 ({exc})"},
            )
            local_chunks = []

        # web + local 合并:web 走 Tavily score (0-1),local 走 cosine 相似度,
        # 两者量纲接近;直接 sort by similarity 让 LLM 看到的角标按重要性
        citations = local_chunks + web_chunks
        citations.sort(key=lambda c: c.similarity, reverse=True)

        if citations:
            rag_context = format_context(citations, max_chars=5000)
            yield _sse("citations", {"items": _citation_payload(citations)})
        elif has_materials or web_search:
            # 显式开了 RAG 或联网,但啥都没拿到
            yield _sse(
                "warning",
                {
                    "message": "未召回到相关资料/笔记/网页,本次将基于通识知识回答"
                },
            )

        async for delta in stream_reply(
            agent=agent,
            history=history,
            student_profile=student_profile,
            rag_context=rag_context,
            tier=effective_tier,
        ):
            assistant_text_parts.append(delta)
            yield _sse("delta", {"text": delta})

        full_text = "".join(assistant_text_parts).strip()
        assistant_message_id: str | None = None
        if full_text:
            assistant_meta: dict = {
                "model_tier": effective_tier.value,
                "model": model_name,
                "agent_type": agent.agent_type,
            }
            if citations:
                assistant_meta["citations"] = _citation_payload(citations)
            assistant_row = repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=full_text,
                metadata=assistant_meta,
            )
            assistant_message_id = assistant_row.get("id") if assistant_row else None

        # Phase 2: 学科老师对话结束后,异步抽取学生掌握度 (head_teacher 跳过)
        subject_id = session.get("subject_id") or agent.subject_id
        if (
            background_tasks is not None
            and full_text
            and subject_id
            and agent.agent_type != "head_teacher"
        ):
            subject_row = next(
                (s for s in repos.list_subjects() if s["id"] == subject_id), None
            )
            background_tasks.add_task(
                extract_and_update,
                student_id=user_id,
                subject_id=subject_id,
                subject_name=(subject_row or {}).get("name", subject_id),
                session_id=session_id,
                assistant_message_id=assistant_message_id,
                user_msg=user_content,
                assistant_msg=full_text,
            )

        # Phase 2.5: 主回答 streaming 完成后 inline 生成「下一步建议」,
        # 通过 SSE follow_ups 事件推送,并持久化到 assistant.metadata.follow_ups
        if full_text:
            try:
                follow_ups = await suggest_follow_ups(
                    student_id=user_id,
                    agent=agent,
                    subject_id=subject_id,
                    user_msg=user_content,
                    assistant_msg=full_text,
                )
            except Exception as exc:
                logger.warning("suggest_follow_ups 失败: %s", exc)
                follow_ups = []

            if follow_ups:
                items = [fu.model_dump() for fu in follow_ups]
                yield _sse("follow_ups", {"items": items})
                if assistant_message_id:
                    try:
                        client = get_admin_client()
                        current = (
                            client.table("chat_messages")
                            .select("metadata")
                            .eq("id", assistant_message_id)
                            .maybe_single()
                            .execute()
                        )
                        md = (current.data or {}).get("metadata") or {}
                        md["follow_ups"] = items
                        client.table("chat_messages").update({"metadata": md}).eq(
                            "id", assistant_message_id
                        ).execute()
                    except Exception as exc:
                        logger.warning("写回 follow_ups 失败: %s", exc)

        if not session.get("title") or session.get("title", "").endswith("的对话"):
            short_title = user_content.strip().splitlines()[0][:20]
            if short_title:
                repos.touch_session(session_id, title=short_title)
            else:
                repos.touch_session(session_id)
        else:
            repos.touch_session(session_id)

        yield _sse(
            "done",
            {
                "length": len(full_text),
                "citation_count": len(citations),
                "model": model_name,
                "model_tier": effective_tier.value,
            },
        )
    except Exception as exc:
        logger.exception("LLM stream failed")
        partial = "".join(assistant_text_parts).strip()
        if partial:
            repos.insert_message(
                session_id=session_id,
                role="assistant",
                content=partial + "\n\n(回复中断,请重试)",
                metadata={"error": str(exc), "partial": True},
            )
        yield _sse("error", {"message": str(exc)})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
