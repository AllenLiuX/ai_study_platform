"""Phase 6.2: 音频 → 文本转写服务 (基于 OpenAI Whisper / gpt-4o-transcribe)。

设计上被『听课』页面反复调用:
- 前端 MediaRecorder 每 ~12s 结束一个 chunk (完整的 webm/mp4 段)
- POST /api/lecture/transcribe (multipart) 到本模块
- 直接透传给 OpenAI transcriptions endpoint,返回纯文本

因为一段就是一段独立音频,不做跨段上下文;LLM 已足够处理中英文混说 +
学科术语。想更稳可以带 language='zh' + prompt 提示。
"""

from __future__ import annotations

import io
import logging

from openai import APIError as OpenAIAPIError

from ..core.config import get_settings
from ..core.llm import get_client

logger = logging.getLogger(__name__)

# 单段音频硬上限 25MB (OpenAI whisper endpoint 官方上限)
# 前端 12s * ~48kbps ≈ 72KB,离上限极远;这里保留以防未来支持整段上传
MAX_AUDIO_BYTES = 25 * 1024 * 1024

# 中文课堂常见术语提示 — 用来轻推 Whisper 在中英文夹杂 / 数理术语上的识别
_DEFAULT_PROMPT = (
    "以下是一堂中文课的录音,可能涉及数学、物理、化学、生物、语文、英语、"
    "历史、地理等学科的专业术语与英文缩写,请准确转写。"
)


async def transcribe_audio(
    *,
    data: bytes,
    filename: str,
    language: str | None = "zh",
    prompt: str | None = None,
) -> str:
    """把一段音频字节流转写为文本。返回纯字符串,失败抛异常。

    filename 只用来给 openai SDK 一个正确的后缀 (.webm / .mp4 / .m4a / .wav),
    这样 SDK 才能推断 content-type 并让服务端选对解码器。
    """
    if not data:
        raise ValueError("音频数据为空")
    if len(data) > MAX_AUDIO_BYTES:
        raise ValueError(
            f"单段音频过大 ({len(data) / 1024 / 1024:.1f}MB),上限 "
            f"{MAX_AUDIO_BYTES // 1024 // 1024}MB"
        )

    settings = get_settings()
    client = get_client()
    model = settings.openai_transcription_model

    # OpenAI SDK 期望一个 file-like,tuple 形式 (name, bytes) 也行
    # 用 BytesIO + name 让 SDK 生成正确的 multipart 段
    buf = io.BytesIO(data)
    buf.name = filename or "chunk.webm"

    kwargs: dict = {
        "model": model,
        "file": buf,
        # response_format = text 直接返回字符串,少一层 JSON 解析
        "response_format": "text",
    }
    if language:
        kwargs["language"] = language
    if prompt is not None:
        kwargs["prompt"] = prompt
    elif language == "zh":
        kwargs["prompt"] = _DEFAULT_PROMPT

    try:
        resp = await client.audio.transcriptions.create(**kwargs)
    except OpenAIAPIError as exc:
        logger.warning("whisper transcribe failed for %s: %s", filename, exc)
        raise

    # response_format='text' 时 SDK 返回一个 str-like 对象或直接 str
    text = str(resp).strip() if resp is not None else ""
    return text
