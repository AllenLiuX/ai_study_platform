"""文件解析:把上传文件的字节流提取为纯文本。

Phase 1 支持的类型:
- application/pdf  (`pypdf`)
- text/plain      (utf-8 解码)
- text/markdown   (utf-8 解码)

后续可扩展:
- application/vnd.openxmlformats-officedocument.wordprocessingml.document (python-docx)
- image/*  (OCR,例如 paddleocr / vision API)
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from pypdf import PdfReader

logger = logging.getLogger(__name__)


SUPPORTED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "text/plain": "text",
    "text/markdown": "text",
    "text/x-markdown": "text",
    # 浏览器对 .md 经常吐空 mime,后端补一个回退
    "application/octet-stream": "binary",
}


SUPPORTED_EXTENSIONS: dict[str, str] = {
    "pdf": "pdf",
    "txt": "text",
    "md": "text",
    "markdown": "text",
}


@dataclass(slots=True)
class ParseResult:
    text: str
    char_count: int
    page_count: int | None
    detected_kind: str


def detect_kind(mime_type: str, filename: str) -> str | None:
    """返回 'pdf' / 'text' / None。

    优先看 MIME,fallback 看扩展名。返回 None 表示当前 Phase 不支持。
    """
    mime = (mime_type or "").lower().split(";")[0].strip()
    kind = SUPPORTED_MIME_TYPES.get(mime)
    if kind == "binary":
        kind = None
    if kind:
        return kind
    if "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        return SUPPORTED_EXTENSIONS.get(ext)
    return None


def parse_bytes(*, data: bytes, mime_type: str, filename: str) -> ParseResult:
    """解析文件字节流。返回纯文本与元信息。

    若类型不支持或解析失败,抛 ValueError(由上层捕获写入 parse_status='failed')。
    """
    kind = detect_kind(mime_type, filename)
    if kind == "pdf":
        return _parse_pdf(data)
    if kind == "text":
        return _parse_text(data)
    raise ValueError(
        f"暂不支持的文件类型: mime={mime_type!r}, filename={filename!r}。"
        "目前仅支持 PDF / TXT / Markdown。"
    )


def _parse_pdf(data: bytes) -> ParseResult:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:  # PDF 损坏 / 加密
        raise ValueError(f"无法解析 PDF: {exc}") from exc

    page_texts: list[str] = []
    for idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:
            logger.warning("PDF page %d extract failed: %s", idx, exc)
            text = ""
        if text.strip():
            page_texts.append(text.strip())

    full = "\n\n".join(page_texts).strip()
    if not full:
        raise ValueError(
            "PDF 中没有提取到可读文本,可能是扫描件或图片型 PDF。"
            "Phase 1 暂不做 OCR,后续会补。"
        )
    return ParseResult(
        text=full,
        char_count=len(full),
        page_count=len(reader.pages),
        detected_kind="pdf",
    )


def _parse_text(data: bytes) -> ParseResult:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            text = data.decode(encoding).strip()
            if text:
                return ParseResult(
                    text=text,
                    char_count=len(text),
                    page_count=None,
                    detected_kind="text",
                )
        except UnicodeDecodeError:
            continue
    raise ValueError("文本文件解码失败,请确认编码是 UTF-8 或 GBK。")
