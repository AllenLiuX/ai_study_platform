"""OpenAI 嵌入接口封装。

text-embedding-3-small:
- 输出 1536 维
- 单次最多 2048 个输入,每个输入最多 8191 tokens
- 我们的 chunk 远小于上限,这里只做基础分批

返回的 embedding 是普通 Python list[float],可以直接喂给 supabase-py
插入 pgvector 列。
"""

from __future__ import annotations

import logging
from typing import Sequence

from ..core.config import get_settings
from ..core.llm import get_client

logger = logging.getLogger(__name__)

EMBED_BATCH_SIZE = 64


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """对一组文本生成 embedding。失败时抛异常。"""
    if not texts:
        return []
    client = get_client()
    model = get_settings().openai_embedding_model
    out: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = list(texts[start : start + EMBED_BATCH_SIZE])
        resp = await client.embeddings.create(model=model, input=batch)
        out.extend([item.embedding for item in resp.data])
    return out


async def embed_one(text: str) -> list[float]:
    """单条文本 embedding 的便捷封装。"""
    arr = await embed_texts([text])
    return arr[0] if arr else []
