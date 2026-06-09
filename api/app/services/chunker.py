"""文本切片:把整篇文本切成可嵌入的 chunk。

策略 (Phase 1):
- 优先按段落/标点切断,保证语义完整
- 用 tiktoken 控制每段 token 数 (目标 400,上限 600)
- 相邻 chunk 保留 50 token 重叠,降低边界处召回失真

text-embedding-3-small 上下文 8191 tokens,我们一片远低于上限,
留给 prompt + 多 chunk 拼接的空间足够。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import tiktoken

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Chunk:
    index: int
    content: str
    char_count: int
    token_count: int


# 句号 / 问号 / 感叹号 / 中文标点 + 换行
_SENTENCE_PAT = re.compile(r"(?<=[。！？!?\.])\s+|\n{2,}")


def _encoder() -> tiktoken.Encoding:
    """text-embedding-3-small 用 cl100k_base 编码器。"""
    return tiktoken.get_encoding("cl100k_base")


def _split_sentences(text: str) -> list[str]:
    """按段落和句号切。返回非空段落列表。"""
    parts: list[str] = []
    for block in re.split(r"\n{2,}", text):
        block = block.strip()
        if not block:
            continue
        # 段落内再按句切
        sentences = _SENTENCE_PAT.split(block)
        for s in sentences:
            s = s.strip()
            if s:
                parts.append(s)
    return parts


def chunk_text(
    text: str,
    *,
    target_tokens: int = 400,
    max_tokens: int = 600,
    overlap_tokens: int = 50,
) -> list[Chunk]:
    """把长文本切成 Chunk 列表。

    思路:贪心累积句子,达到 target_tokens 切一刀;末尾保留 overlap_tokens
    个 token 用于和下一段重叠,保证关键术语不会刚好被切断。
    """
    text = (text or "").strip()
    if not text:
        return []

    enc = _encoder()
    sentences = _split_sentences(text)
    if not sentences:
        return []

    # 预编码每个句子,避免重复 encode
    encoded = [(s, enc.encode(s)) for s in sentences]

    chunks: list[Chunk] = []
    buf_sentences: list[str] = []
    buf_tokens: list[int] = []
    buf_len = 0

    def _flush() -> None:
        nonlocal buf_sentences, buf_tokens, buf_len
        if not buf_sentences:
            return
        content = " ".join(buf_sentences).strip()
        chunks.append(
            Chunk(
                index=len(chunks),
                content=content,
                char_count=len(content),
                token_count=len(buf_tokens),
            )
        )
        # 保留尾部 overlap_tokens 作为下一段开头
        if overlap_tokens > 0 and buf_len > overlap_tokens:
            tail_tokens = buf_tokens[-overlap_tokens:]
            tail_text = enc.decode(tail_tokens)
            buf_sentences = [tail_text]
            buf_tokens = list(tail_tokens)
            buf_len = len(tail_tokens)
        else:
            buf_sentences = []
            buf_tokens = []
            buf_len = 0

    for sentence, sentence_tokens in encoded:
        s_len = len(sentence_tokens)
        # 单句就超过 max_tokens — 硬切成 sub-chunk,避免无限累积
        if s_len > max_tokens:
            if buf_sentences:
                _flush()
            # 按 token 滑窗硬切
            step = target_tokens
            for start in range(0, s_len, step):
                window = sentence_tokens[start : start + step]
                if not window:
                    continue
                content = enc.decode(window).strip()
                if content:
                    chunks.append(
                        Chunk(
                            index=len(chunks),
                            content=content,
                            char_count=len(content),
                            token_count=len(window),
                        )
                    )
            continue

        # 加上当前句会超 target_tokens 就先 flush
        if buf_len + s_len > target_tokens and buf_sentences:
            _flush()

        buf_sentences.append(sentence)
        buf_tokens.extend(sentence_tokens)
        buf_len += s_len

        if buf_len >= max_tokens:
            _flush()

    _flush()
    # 重排 index (因为有时 flush 会把 overlap 留到下一段,index 应保持顺序)
    for i, ch in enumerate(chunks):
        ch.index = i
    return chunks
