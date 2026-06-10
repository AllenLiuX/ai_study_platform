"""Phase 4.1: 用 OpenAI vision 模型从图片 / 扫描版 PDF 提取文字。

定位:`parser.py` 走不通(纯文本抽不到字)时的兜底,以及 image/* 类型资料的
唯一抽取路径。输出 markdown 文本,可直接走老的 chunk + embed 流水线进 RAG。

策略:
- 图片  → 直接喂给 vision 模型,要求输出 markdown (公式 LaTeX、表格保留)
- PDF   → pypdfium2 把每页渲染成 PNG,逐页 OCR 后拼接成完整 markdown
- 模型  → LOW 档 (`gpt-5.4-mini`),OCR 类任务足够准 + 便宜 (~$0.0008/张)

保护性约束:
- MAX_PDF_PAGES = 20:超过的部分仅处理前 20 页,记 log;避免一次烧光额度
- MAX_PARALLEL = 4:并发上限,避免一份大 PDF 占满整个 OpenAI 并发预算
- PDF_RENDER_SCALE ≈ 192 dpi:字够清,token 不会爆
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging

import pypdfium2 as pdfium
from PIL import Image  # noqa: F401 — pypdfium2.PdfBitmap.to_pil 隐式依赖 Pillow

from ..core.llm import ModelTier, get_client, resolve_model

logger = logging.getLogger(__name__)


# ---- 限制 ----------------------------------------------------------------
MAX_PDF_PAGES = 300
MAX_PARALLEL = 4
PDF_RENDER_SCALE = 1.6  # 大约 192 dpi
PNG_MAX_LONG_EDGE = 2000  # 渲染出来的图压到长边 ≤ 2000 px,控制 token


# ---- 系统 prompt ---------------------------------------------------------
_OCR_SYSTEM_PROMPT = """你是一个 OCR 助手和学习资料整理员。

我会给你一张学习资料截图(讲义、笔记、试卷、教材片段、错题等),请把图中的全部内容按原顺序抽取为 markdown,要求:

1. 忠实抽取,不要总结、不要评论、不要添加图中没有的内容
2. 数学公式使用 LaTeX:行内 `$x^2+1$`,行间 `$$\\frac{a}{b}$$`
3. 题号、章节号、加粗、列表、表格都用 markdown 习惯保留 (表格用 markdown table)
4. 看不清/被遮挡的字写 `[模糊]`,不要瞎猜
5. 图示 / 几何图形等用一句话简述,例如 `[图:坐标系中两条相交直线]`
6. 不要在输出外面包 ```markdown 代码块,直接输出 markdown

只输出抽取结果本身。"""


def _png_data_url(png_bytes: bytes) -> str:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _png_from_pil(pil_image: "Image.Image") -> bytes:
    """把 PIL 图压到 ≤ PNG_MAX_LONG_EDGE 长边后导出 PNG 字节。"""
    w, h = pil_image.size
    longest = max(w, h)
    if longest > PNG_MAX_LONG_EDGE:
        ratio = PNG_MAX_LONG_EDGE / longest
        pil_image = pil_image.resize(
            (max(1, int(w * ratio)), max(1, int(h * ratio))),
            Image.LANCZOS,  # type: ignore[attr-defined]
        )
    buf = io.BytesIO()
    pil_image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _render_pdf_to_pngs(pdf_bytes: bytes) -> list[bytes]:
    """把 PDF 的每页渲染成 PNG 字节流。超过 MAX_PDF_PAGES 截断。"""
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        total = len(pdf)
        pages = min(total, MAX_PDF_PAGES)
        if total > MAX_PDF_PAGES:
            logger.warning(
                "PDF has %d pages, OCR will only cover first %d", total, MAX_PDF_PAGES
            )
        pngs: list[bytes] = []
        for i in range(pages):
            page = pdf[i]
            try:
                bitmap = page.render(scale=PDF_RENDER_SCALE)
                pil = bitmap.to_pil()
                pngs.append(_png_from_pil(pil))
            finally:
                page.close()
        return pngs
    finally:
        pdf.close()


async def _ocr_single_image(png_bytes: bytes, *, mime: str = "image/png") -> str:
    """单张图喂给 vision,返回 markdown 文本(可能为空)。"""
    client = get_client()
    model = resolve_model(ModelTier.LOW)
    b64 = base64.b64encode(png_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    messages = [
        {"role": "system", "content": _OCR_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请抽取这张图片中的全部文字、公式、表格。"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0,
    )
    return (resp.choices[0].message.content or "").strip()


async def extract_image(*, data: bytes, mime: str) -> str:
    """单张图 → markdown 文本。失败抛 ValueError。"""
    try:
        text = await _ocr_single_image(data, mime=mime)
    except Exception as exc:
        raise ValueError(f"vision 模型调用失败: {exc}") from exc
    if not text:
        raise ValueError("vision 模型未能从图中提取出文字")
    return text


async def extract_pdf_via_vision(pdf_bytes: bytes) -> str:
    """对 PDF 逐页 vision OCR,拼接为完整 markdown。

    每一页失败不致命(会写 [第 N 页 OCR 失败]),但所有页都失败抛 ValueError。
    """
    pngs = await asyncio.to_thread(_render_pdf_to_pngs, pdf_bytes)
    if not pngs:
        raise ValueError("PDF 为空或无可渲染页面")

    sem = asyncio.Semaphore(MAX_PARALLEL)

    async def _do(idx: int, png: bytes) -> tuple[int, str]:
        async with sem:
            try:
                text = await _ocr_single_image(png, mime="image/png")
                if not text:
                    text = f"[第 {idx + 1} 页:OCR 未抽到文字]"
            except Exception as exc:
                logger.warning("OCR page %d failed: %s", idx + 1, exc)
                text = f"[第 {idx + 1} 页:OCR 失败 — {exc}]"
            return idx, text

    results = await asyncio.gather(*(_do(i, p) for i, p in enumerate(pngs)))
    results.sort(key=lambda x: x[0])

    pieces: list[str] = []
    success = 0
    for i, text in results:
        if text.strip():
            pieces.append(f"## 第 {i + 1} 页\n\n{text.strip()}")
            if not text.lstrip().startswith("["):
                success += 1
    full = "\n\n".join(pieces).strip()
    if success == 0:
        raise ValueError("整份 PDF 的 vision 提取均失败")
    return full
