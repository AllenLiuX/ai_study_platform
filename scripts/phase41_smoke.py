#!/usr/bin/env python
"""Phase 4.1 冒烟:资料库视觉提取。

不调 OpenAI,只验证:
1. parser.detect_kind 对 image/pdf/text/未知 正确返回
2. EmptyPdfTextError 是 ValueError 子类,触发 vision fallback
3. pypdfium2 渲染流水线工作 (in-memory 空白 PDF → PNG 字节)
4. _extract_text dispatch 正确 — image 走 vision,PDF 抽空走 vision,文本走老路
   (用 monkeypatch 替换 vision_extractor 的函数,避免真打 OpenAI)
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from app.services import material_processor, parser, vision_extractor  # noqa: E402

GREEN = "\033[32m"
RED = "\033[31m"
NC = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓ {msg}{NC}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{NC}")
    sys.exit(1)


def make_empty_pdf() -> bytes:
    """空白 PDF (1 页) — pypdf 抽不到任何文字。"""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument.new()
    pdf.new_page(200, 200)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


async def main() -> None:
    # 1. detect_kind 全面
    cases = [
        ("application/pdf", "x.pdf", "pdf"),
        ("text/plain", "x.txt", "text"),
        ("text/markdown", "x.md", "text"),
        ("image/png", "x.png", "image"),
        ("image/jpeg", "x.jpg", "image"),
        ("image/webp", "x.webp", "image"),
        ("application/octet-stream", "x.md", "text"),  # mime 失效 → 扩展名兜底
        ("application/octet-stream", "x.PNG", "image"),  # 大小写
        ("application/zip", "x.zip", None),  # 不支持
    ]
    for mime, name, expect in cases:
        got = parser.detect_kind(mime, name)
        if got != expect:
            fail(f"detect_kind({mime!r},{name!r}) = {got!r}, expected {expect!r}")
    ok(f"detect_kind 全部 {len(cases)} 例通过")

    # 2. EmptyPdfTextError 是 ValueError 子类
    assert issubclass(parser.EmptyPdfTextError, ValueError)
    ok("EmptyPdfTextError <: ValueError (旧 except 仍能 catch)")

    # 3. 空白 PDF → pypdf 抽空 → 触发 EmptyPdfTextError
    pdf_bytes = make_empty_pdf()
    try:
        parser.parse_bytes(
            data=pdf_bytes, mime_type="application/pdf", filename="empty.pdf"
        )
        fail("空白 PDF 居然抽到了文字?")
    except parser.EmptyPdfTextError:
        ok("空白 PDF 触发 EmptyPdfTextError (走 vision fallback 的入口正确)")
    except Exception as exc:
        fail(f"空白 PDF 抛了非预期异常: {type(exc).__name__}: {exc}")

    # 4. pypdfium2 渲染流水线:空白 PDF → PNG bytes
    pngs = vision_extractor._render_pdf_to_pngs(pdf_bytes)
    if not pngs or not pngs[0].startswith(b"\x89PNG"):
        fail("pypdfium2 → PNG 流水线坏了")
    ok(f"pypdfium2 → PNG 工作 (1 页 -> {len(pngs[0])} bytes PNG)")

    # 5. dispatch:image 走 vision, PDF 抽空走 vision, text 走老路
    calls: list[str] = []

    async def fake_image(*, data: bytes, mime: str) -> str:
        calls.append(f"image:{mime}:{len(data)}")
        return "# 模拟图片提取\n\n这是 mock 出来的 markdown"

    async def fake_pdf(pdf_bytes: bytes) -> str:
        calls.append(f"pdf:{len(pdf_bytes)}")
        return "## 第 1 页\n\n空白页"

    vision_extractor.extract_image = fake_image  # type: ignore[assignment]
    vision_extractor.extract_pdf_via_vision = fake_pdf  # type: ignore[assignment]

    # a) image kind → fake_image
    r = await material_processor._extract_text(
        data=b"\x89PNG\x00\x00\x00", mime_type="image/png", filename="题目.png"
    )
    assert "图片提取" in r.text
    assert r.detected_kind == "image+vision"
    assert calls and calls[-1].startswith("image:image/png:")
    ok("image kind → vision_extractor.extract_image")

    # b) 空 PDF → fake_pdf
    r = await material_processor._extract_text(
        data=pdf_bytes, mime_type="application/pdf", filename="scan.pdf"
    )
    assert "第 1 页" in r.text
    assert r.detected_kind == "pdf+vision"
    assert calls[-1].startswith("pdf:")
    ok("空 PDF → EmptyPdfTextError → vision_extractor.extract_pdf_via_vision")

    # c) text → 老路 (不调 vision)
    before_calls = len(calls)
    r = await material_processor._extract_text(
        data="# hello\n\n世界".encode("utf-8"),
        mime_type="text/markdown",
        filename="notes.md",
    )
    assert "hello" in r.text and "世界" in r.text
    assert r.detected_kind == "text"
    if len(calls) != before_calls:
        fail("text 不应该调用 vision_extractor")
    ok("text 走原 parser.parse_bytes,未触碰 vision")

    print(f"\n{GREEN}Phase 4.1 smoke PASSED (5 项断言){NC}")


if __name__ == "__main__":
    asyncio.run(main())
