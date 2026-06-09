"""资料后处理:从 Storage 拉文件 → 解析 → 切片 → 向量化 → 落库。

被 FastAPI BackgroundTasks 调用,生命周期与请求解耦。
小文件 (典型教辅 PDF < 20MB) 处理时间在 5-30 秒之间,前端轮询 parse_status 即可。
"""

from __future__ import annotations

import asyncio
import logging

from ..db import repos
from ..db.supabase_client import get_admin_client
from . import parser, chunker, embedding

logger = logging.getLogger(__name__)

STORAGE_BUCKET = "materials"


def _download_bytes(storage_path: str) -> bytes:
    client = get_admin_client()
    return client.storage.from_(STORAGE_BUCKET).download(storage_path)


async def process_material(material_id: str) -> None:
    """处理上传后的资料。无返回,状态写回 learning_materials。

    注意:此函数被 BackgroundTasks 调度,异常要全部内部捕获,避免静默失败。
    """
    logger.info("start processing material %s", material_id)
    repos.update_material(material_id, {"parse_status": "processing", "parse_error": None})

    material = repos.get_material_by_id(material_id)
    if not material:
        logger.warning("material %s vanished before processing", material_id)
        return

    try:
        data = await asyncio.to_thread(_download_bytes, material["storage_path"])
        result = parser.parse_bytes(
            data=data,
            mime_type=material.get("mime_type") or "",
            filename=material.get("original_filename") or "",
        )

        chunks = chunker.chunk_text(result.text)
        if not chunks:
            raise ValueError("文本切片为空,可能内容过短")

        embeddings = await embedding.embed_texts([c.content for c in chunks])
        if len(embeddings) != len(chunks):
            raise RuntimeError(
                f"embedding 数量与 chunk 不一致: {len(embeddings)} vs {len(chunks)}"
            )

        rows = [
            {
                "material_id": material_id,
                "chunk_index": ch.index,
                "content": ch.content,
                "char_count": ch.char_count,
                "token_count": ch.token_count,
                "embedding": emb,
            }
            for ch, emb in zip(chunks, embeddings)
        ]
        repos.delete_material_chunks(material_id)
        repos.insert_material_chunks(rows)

        # 简化版 summary:首段或前 200 字
        summary = result.text.strip().splitlines()[0][:200].strip() if result.text.strip() else None

        repos.update_material(
            material_id,
            {
                "parse_status": "ready",
                "parse_error": None,
                "parsed_text": result.text,
                "summary": summary,
                "chunk_count": len(chunks),
            },
        )
        logger.info("material %s ready: %d chunks", material_id, len(chunks))
    except Exception as exc:
        logger.exception("material %s processing failed", material_id)
        repos.update_material(
            material_id,
            {
                "parse_status": "failed",
                "parse_error": str(exc),
                "chunk_count": 0,
            },
        )
