"""RAG 检索:把用户查询变成 query embedding,从 pgvector 召回 top-k chunks。"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..db.supabase_client import get_admin_client
from .embedding import embed_one

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RetrievedChunk:
    chunk_id: str
    material_id: str
    material_title: str
    material_subject: str | None
    chunk_index: int
    content: str
    similarity: float


async def retrieve_chunks(
    *,
    query: str,
    owner_id: str | None,
    material_ids: list[str] | None,
    top_k: int = 5,
    min_similarity: float = 0.2,
) -> list[RetrievedChunk]:
    """根据 query 召回 top-k chunks。

    参数:
    - owner_id: 仅检索该学生的资料 + 平台公共资料;为 None 时不按 owner 过滤(管理用)
    - material_ids: 进一步限定到这些资料 (如学生在 chat 时勾选了几份)
    - min_similarity: 过滤掉相似度过低的噪声 (text-embedding-3-small 上通常 0.2 是个合理阈值)
    """
    if not query.strip():
        return []
    if material_ids is not None and len(material_ids) == 0:
        # 显式传空列表 = 不引用任何资料,直接短路
        return []

    embedding = await embed_one(query)
    if not embedding:
        return []

    client = get_admin_client()
    params: dict[str, object] = {
        "query_embedding": embedding,
        "match_count": top_k,
    }
    if owner_id:
        params["p_owner_id"] = owner_id
    if material_ids:
        params["p_material_ids"] = material_ids

    try:
        resp = client.rpc("match_material_chunks", params).execute()
    except Exception as exc:
        logger.exception("vector retrieval failed")
        raise RuntimeError(f"向量检索失败: {exc}") from exc

    rows = resp.data or []
    out: list[RetrievedChunk] = []
    for row in rows:
        sim = float(row.get("similarity") or 0.0)
        if sim < min_similarity:
            continue
        out.append(
            RetrievedChunk(
                chunk_id=row["chunk_id"],
                material_id=row["material_id"],
                material_title=row.get("material_title") or "(无标题)",
                material_subject=row.get("material_subject"),
                chunk_index=int(row.get("chunk_index") or 0),
                content=row.get("content") or "",
                similarity=sim,
            )
        )
    return out


def format_context(chunks: list[RetrievedChunk], max_chars: int = 4000) -> str:
    """把召回的 chunks 拼成可注入 prompt 的上下文段。

    带编号 + 资料标题,方便 LLM 引用 (例如「依据资料 [1]」)。
    """
    if not chunks:
        return ""
    parts: list[str] = []
    used = 0
    for i, c in enumerate(chunks, start=1):
        snippet = c.content.strip()
        header = f"[{i}] 《{c.material_title}》第 {c.chunk_index + 1} 段 (相似度 {c.similarity:.2f})"
        block = f"{header}\n{snippet}"
        if used + len(block) > max_chars and parts:
            break
        parts.append(block)
        used += len(block) + 2
    return "\n\n".join(parts)
