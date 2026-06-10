"""Phase 5: 把 knowledge_notes 切片 + embedding 入库。

与 material_processor 同结构,但走 knowledge_note_chunks 表 / match_knowledge_notes RPC。
作为 chat 中"保存为笔记"的后台异步流程,失败不阻塞 UI。
"""

from __future__ import annotations

import logging

from ..db import repos
from ..db.supabase_client import get_admin_client
from .chunker import chunk_text
from .embedding import embed_texts

logger = logging.getLogger(__name__)


def _set_status(note_id: str, *, status: str, chunk_count: int | None = None, error: str | None = None) -> None:
    fields: dict = {"chunk_status": status}
    if chunk_count is not None:
        fields["chunk_count"] = chunk_count
    if error is not None:
        fields["chunk_error"] = error[:500]
    elif status == "ready":
        fields["chunk_error"] = None
    client = get_admin_client()
    client.table("knowledge_notes").update(fields).eq("id", note_id).execute()


async def reindex_note(note_id: str) -> int:
    """重切 + 重嵌:把这条笔记的 chunk 全部替换。返回最终 chunk 数。

    失败抛异常,调用方负责更新 chunk_status / chunk_error。
    """
    client = get_admin_client()
    note = (
        client.table("knowledge_notes")
        .select("id,title,content,summary")
        .eq("id", note_id)
        .maybe_single()
        .execute()
    )
    row = note.data if note else None
    if not row:
        raise ValueError(f"笔记不存在: {note_id}")

    # 笔记体不大 (上限 20000 字),切片少 — 简单粗暴重切就好
    repos.delete_note_chunks(note_id)

    body = (row.get("content") or "").strip()
    if not body:
        return 0

    # 标题 + 摘要 + 正文一起作 chunker 输入,提升关键词召回质量
    title = (row.get("title") or "").strip()
    summary = (row.get("summary") or "").strip()
    head_lines = []
    if title:
        head_lines.append(f"# {title}")
    if summary:
        head_lines.append(summary)
    combined = ("\n\n".join(head_lines) + "\n\n" + body).strip()

    chunks = chunk_text(combined, target_tokens=400, max_tokens=600, overlap_tokens=50)
    if not chunks:
        return 0

    embeddings = await embed_texts([c.content for c in chunks])
    rows = [
        {
            "note_id": note_id,
            "chunk_index": c.index,
            "content": c.content,
            "char_count": c.char_count,
            "token_count": c.token_count,
            "embedding": emb,
            "metadata": {},
        }
        for c, emb in zip(chunks, embeddings, strict=True)
    ]
    repos.insert_note_chunks(rows)
    return len(rows)


async def process_note(note_id: str) -> None:
    """后台入口:负责 status 流转 + 异常落库。"""
    try:
        _set_status(note_id, status="processing")
        n = await reindex_note(note_id)
        _set_status(note_id, status="ready", chunk_count=n)
        logger.info("note %s indexed (%d chunks)", note_id, n)
    except Exception as exc:
        logger.exception("note %s index failed", note_id)
        _set_status(note_id, status="failed", error=str(exc))
