"""RAG 检索:把用户查询 embed,从 pgvector 召回 top-k chunks。

Phase 5 扩展:
- 同时支持 material_chunks (公共/私有资料) 与 knowledge_note_chunks (私有笔记)
- chat_service 调 `retrieve_for_chat`,merge 后按 similarity 排序
- RetrievedChunk 多了 `source` (material/note) + `source_id` 区分

Phase 5.5 扩展:
- 新增 `source="web"` 用于对话联网搜索 (Tavily 等);走同一条 RetrievedChunk
  通道,format_context 自动带 `[网页]` 标签,citation 落库带 url
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Literal

from ..db.supabase_client import get_admin_client
from .embedding import embed_one

logger = logging.getLogger(__name__)

RetrievalSource = Literal["material", "note", "web"]


@dataclass(slots=True)
class RetrievedChunk:
    """与前端 / LLM 上下文交换的 chunk 抽象。

    - source: 来源类型 (material / note / web)
    - source_id: material_id / note_id / url
    - source_title: 资料标题 / 笔记标题 / 网页 title
    - source_subject: material 才有 (笔记走 tags),其他填 None
    - similarity: pgvector cosine 相似度;web 走 Tavily relevance score
    - extra: 附加信息,web 至少含 url / published_date,note 含 tags
    """

    chunk_id: str
    source: RetrievalSource
    source_id: str
    source_title: str
    source_subject: str | None
    chunk_index: int
    content: str
    similarity: float
    extra: dict | None = field(default=None)

    # 兼容字段 — 旧代码可能直接读 material_id / material_title
    @property
    def material_id(self) -> str:
        return self.source_id

    @property
    def material_title(self) -> str:
        return self.source_title

    @property
    def material_subject(self) -> str | None:
        return self.source_subject


async def _embed(query: str) -> list[float] | None:
    if not query.strip():
        return None
    embedding = await embed_one(query)
    return embedding or None


async def retrieve_material_chunks(
    *,
    query_embedding: list[float],
    owner_id: str | None,
    material_ids: list[str] | None,
    top_k: int = 5,
    min_similarity: float = 0.2,
) -> list[RetrievedChunk]:
    """Materials RPC:match_material_chunks。material_ids=[] 表示短路。"""
    if material_ids is not None and len(material_ids) == 0:
        return []
    client = get_admin_client()
    params: dict[str, object] = {
        "query_embedding": query_embedding,
        "match_count": top_k,
    }
    if owner_id:
        params["p_owner_id"] = owner_id
    if material_ids:
        params["p_material_ids"] = material_ids
    try:
        resp = client.rpc("match_material_chunks", params).execute()
    except Exception as exc:
        logger.exception("material retrieval failed")
        raise RuntimeError(f"向量检索失败 (materials): {exc}") from exc
    out: list[RetrievedChunk] = []
    for row in resp.data or []:
        sim = float(row.get("similarity") or 0.0)
        if sim < min_similarity:
            continue
        out.append(
            RetrievedChunk(
                chunk_id=row["chunk_id"],
                source="material",
                source_id=row["material_id"],
                source_title=row.get("material_title") or "(无标题)",
                source_subject=row.get("material_subject"),
                chunk_index=int(row.get("chunk_index") or 0),
                content=row.get("content") or "",
                similarity=sim,
            )
        )
    return out


async def retrieve_note_chunks(
    *,
    query_embedding: list[float],
    owner_id: str,
    note_ids: list[str] | None = None,
    top_k: int = 3,
    min_similarity: float = 0.2,
) -> list[RetrievedChunk]:
    """Notes RPC:match_knowledge_notes。owner_id 必填 (笔记是私有的)。"""
    client = get_admin_client()
    params: dict[str, object] = {
        "query_embedding": query_embedding,
        "match_count": top_k,
        "p_owner_id": owner_id,
    }
    if note_ids:
        params["p_note_ids"] = note_ids
    try:
        resp = client.rpc("match_knowledge_notes", params).execute()
    except Exception as exc:
        logger.exception("note retrieval failed")
        raise RuntimeError(f"向量检索失败 (notes): {exc}") from exc
    out: list[RetrievedChunk] = []
    for row in resp.data or []:
        sim = float(row.get("similarity") or 0.0)
        if sim < min_similarity:
            continue
        out.append(
            RetrievedChunk(
                chunk_id=row["chunk_id"],
                source="note",
                source_id=row["note_id"],
                source_title=row.get("note_title") or "(无标题)",
                source_subject=None,
                chunk_index=int(row.get("chunk_index") or 0),
                content=row.get("content") or "",
                similarity=sim,
                extra={"tags": row.get("note_tags") or []},
            )
        )
    return out


async def retrieve_for_chat(
    *,
    query: str,
    owner_id: str,
    material_ids: list[str] | None,
    include_notes: bool = True,
    top_k_materials: int = 5,
    top_k_notes: int = 3,
    min_similarity: float = 0.2,
) -> list[RetrievedChunk]:
    """主入口:一次 embed,同时召回 materials + notes,合并后按 similarity 排序。

    - material_ids: 学生勾选的资料 (含老师 default + 学生手动)。None 等价于 [] (不召回 materials)
    - include_notes: 是否同时召学生的笔记 (默认 True)
    """
    if not query.strip():
        return []
    if (material_ids is None or len(material_ids) == 0) and not include_notes:
        return []

    embedding = await _embed(query)
    if not embedding:
        return []

    out: list[RetrievedChunk] = []
    if material_ids:
        try:
            out.extend(
                await retrieve_material_chunks(
                    query_embedding=embedding,
                    owner_id=owner_id,
                    material_ids=material_ids,
                    top_k=top_k_materials,
                    min_similarity=min_similarity,
                )
            )
        except Exception as exc:
            logger.warning("materials retrieval failed (continue): %s", exc)

    if include_notes:
        try:
            out.extend(
                await retrieve_note_chunks(
                    query_embedding=embedding,
                    owner_id=owner_id,
                    top_k=top_k_notes,
                    min_similarity=min_similarity,
                )
            )
        except Exception as exc:
            logger.warning("notes retrieval failed (continue): %s", exc)

    # 跨源 merge 排序;让 LLM 看到的角标按相似度从高到低
    out.sort(key=lambda c: c.similarity, reverse=True)
    # cap 总条数,避免上下文过长
    return out[: top_k_materials + top_k_notes]


# 旧调用方仍可用 — chat_service 已切到 retrieve_for_chat,这里保留兜底
async def retrieve_chunks(
    *,
    query: str,
    owner_id: str | None,
    material_ids: list[str] | None,
    top_k: int = 5,
    min_similarity: float = 0.2,
) -> list[RetrievedChunk]:
    if not query.strip():
        return []
    if material_ids is not None and len(material_ids) == 0:
        return []
    embedding = await _embed(query)
    if not embedding:
        return []
    return await retrieve_material_chunks(
        query_embedding=embedding,
        owner_id=owner_id,
        material_ids=material_ids,
        top_k=top_k,
        min_similarity=min_similarity,
    )


_SOURCE_LABEL_CN: dict[str, str] = {
    "material": "资料",
    "note": "笔记",
    "web": "网页",
}


def format_context(chunks: list[RetrievedChunk], max_chars: int = 4000) -> str:
    """把召回的 chunks 拼成可注入 prompt 的上下文段。

    给每段加 `[来源类型]《标题》` 让 LLM 在回答时按 [1] [2] 形式引用,
    web 来源额外把 URL 也带上,方便模型在正文里直接给链接。
    """
    if not chunks:
        return ""
    parts: list[str] = []
    used = 0
    for i, c in enumerate(chunks, start=1):
        snippet = c.content.strip()
        label = _SOURCE_LABEL_CN.get(c.source, "资料")
        header_parts = [
            f"[{i}] [{label}]《{c.source_title}》",
        ]
        if c.source == "web":
            url = (c.extra or {}).get("url") if c.extra else None
            if url:
                header_parts.append(f"({url})")
            header_parts.append(f"[相关度 {c.similarity:.2f}]")
        else:
            header_parts.append(f"第 {c.chunk_index + 1} 段")
            header_parts.append(f"(相似度 {c.similarity:.2f})")
        header = " ".join(header_parts)
        block = f"{header}\n{snippet}"
        if used + len(block) > max_chars and parts:
            break
        parts.append(block)
        used += len(block) + 2
    return "\n\n".join(parts)
