"""OpenAI 客户端封装 + 5 档模型分级 (low / medium / high / extra-high / max)。"""

from __future__ import annotations

from enum import Enum
from typing import AsyncIterator, Iterable

import httpx
from openai import AsyncOpenAI

from .config import get_settings


class ModelTier(str, Enum):
    """模型分级。

    Phase 3.5 起共 5 档,学生可在对话时按需选择;后端服务 (extractor / suggester /
    planner) 默认使用 MEDIUM,会自然适配旧 OPENAI_CHAT_MODEL_DEFAULT。

    - LOW         便宜快,适合简单提问
    - MEDIUM      推荐默认,平衡能力与成本
    - HIGH        强逻辑,复杂讲解
    - EXTRA_HIGH  推理模型,长链思考 (需 OpenAI 账号权限)
    - MAX         最强模型,代价最大 (需 OpenAI 账号权限)

    DEFAULT / PREMIUM 是历史别名,等同 MEDIUM / HIGH;旧调用代码不需要改。
    """

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    EXTRA_HIGH = "extra_high"
    MAX = "max"
    # 历史别名 (Python enum:相同 value 会自动成为 alias)
    DEFAULT = "medium"
    PREMIUM = "high"


# tier 元数据 — UI 用来展示能力/成本胶囊,后端 health/config 直接吐。
# capability / cost 用 1-10 量表,严格单调递增。
TIER_META: dict[ModelTier, dict] = {
    ModelTier.LOW: {
        "label": "low",
        "display": "Low",
        "capability": 3,
        "cost": 1,
        "desc": "便宜快速,适合背单词、记概念、简短问答",
    },
    ModelTier.MEDIUM: {
        "label": "medium",
        "display": "Medium",
        "capability": 5,
        "cost": 3,
        "desc": "推荐默认,日常学习问答 / 多数题目讲解都够用",
    },
    ModelTier.HIGH: {
        "label": "high",
        "display": "High",
        "capability": 7,
        "cost": 6,
        "desc": "旗舰对话模型,复杂讲解 / 写作精改 / 难题分析",
    },
    ModelTier.EXTRA_HIGH: {
        "label": "extra-high",
        "display": "Extra-high",
        "capability": 8,
        "cost": 4,
        "desc": "推理模型,慢但深;多步证明 / 物理推导 / 解题链 (需 OpenAI 权限)",
    },
    ModelTier.MAX: {
        "label": "max",
        "display": "Max",
        "capability": 10,
        "cost": 10,
        "desc": "顶级旗舰,代价最大;压轴大题 / 研究级问题 (需 OpenAI 权限)",
    },
}

DEFAULT_TIER = ModelTier.MEDIUM


# 兜底默认 — 当用户没在 .env 里设 OPENAI_CHAT_MODEL_<TIER> 时用。
# 选型 (2026):
#   low         gpt-5.4-mini  ($0.75/$4.5)   便宜快速通用对话
#   medium      gpt-5.4       ($2.50/$15)    主力,日常对话最性价比
#   high        gpt-5.5       ($5/$30)       旗舰通用模型
#   extra_high  o3            ($2/$8)        强推理 (思考模型)
#   max         gpt-5.5-pro   ($30/$180)     顶级旗舰
# 旧 medium/high 仍会先尝试 OPENAI_CHAT_MODEL_DEFAULT/_PREMIUM,保证已有 .env 不用改。
_FALLBACK_MODELS: dict[ModelTier, str] = {
    ModelTier.LOW: "gpt-5.4-mini",
    ModelTier.MEDIUM: "gpt-5.4",
    ModelTier.HIGH: "gpt-5.5",
    ModelTier.EXTRA_HIGH: "o3",
    ModelTier.MAX: "gpt-5.5-pro",
}


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """返回 OpenAI 异步客户端 (单例)。

    显式注入一个 `trust_env=False` 的 httpx client,避免在带本地代理的开发环境
    (例如 ByteDance 的 127.0.0.1:55140) 下被代理拦截。OpenAI 是公网服务,直连即可。
    """
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            http_client=httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(60.0)),
        )
    return _client


def _coerce_tier(tier: ModelTier | str | None) -> ModelTier:
    """容错把字符串 / None 映射回 ModelTier;未知值回落到 DEFAULT_TIER。"""
    if tier is None:
        return DEFAULT_TIER
    if isinstance(tier, ModelTier):
        return tier
    try:
        return ModelTier(tier)
    except ValueError:
        return DEFAULT_TIER


def resolve_model(tier: ModelTier | str | None = None) -> str:
    """根据 tier 解析 OpenAI model 名称。

    优先级:
      1. .env 中 OPENAI_CHAT_MODEL_<TIER>
      2. (medium/high 时) 回落到老的 OPENAI_CHAT_MODEL_DEFAULT / _PREMIUM
      3. 内置 _FALLBACK_MODELS
    """
    t = _coerce_tier(tier)
    settings = get_settings()
    explicit = {
        ModelTier.LOW: settings.openai_chat_model_low,
        ModelTier.MEDIUM: settings.openai_chat_model_medium,
        ModelTier.HIGH: settings.openai_chat_model_high,
        ModelTier.EXTRA_HIGH: settings.openai_chat_model_extra_high,
        ModelTier.MAX: settings.openai_chat_model_max,
    }.get(t, "")
    if explicit:
        return explicit
    # 老变量兜底,保证已有 .env 不动也能跑
    if t == ModelTier.MEDIUM and settings.openai_chat_model_default:
        return settings.openai_chat_model_default
    if t == ModelTier.HIGH and settings.openai_chat_model_premium:
        return settings.openai_chat_model_premium
    return _FALLBACK_MODELS[t]


def list_tiers() -> list[dict]:
    """对外暴露的 tier 列表 (用于 /health/config 和前端 ModelSelector)。"""
    return [
        {
            "tier": t.value,
            "model": resolve_model(t),
            "label": meta["label"],
            "display": meta["display"],
            "capability": meta["capability"],
            "cost": meta["cost"],
            "desc": meta["desc"],
            "is_default": t == DEFAULT_TIER,
        }
        for t, meta in TIER_META.items()
    ]


# =============================================================================
# Reasoning 模型识别 + 安全 kwargs 构造
# =============================================================================
# 2026 年起,OpenAI 把绝大多数主力模型都改成 reasoning 模型 (内部 CoT)。
# Reasoning 模型不接受经典 sampling 参数 (temperature / top_p / presence_penalty
# / frequency_penalty),传了会被 API 拒绝:
#     "Unsupported parameter: 'temperature' is not supported with this model"
#
# 已知 reasoning 模型 (持续扩充,以前缀匹配为主):
#   - o1 / o3 / o4 系列      ("o1-preview", "o3-mini", ...)
#   - GPT-5 系列            ("gpt-5", "gpt-5-mini", "gpt-5-nano",
#                            "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.5-pro")
#   - 例外: "gpt-5-chat-latest" 是老 chat 模型变体,支持 temperature
#
# 工程实践:所有 chat.completions.create() 都用 build_chat_kwargs() 构造参数,
# 让 reasoning 模型自动剔除 temperature,避免每个调用点都判断。
# =============================================================================


def is_reasoning_model(model: str) -> bool:
    """判断模型是否为 reasoning 模型 (不接受 temperature 等 sampling 参数)。"""
    m = (model or "").lower().strip()
    if not m:
        return False
    if m.startswith(("o1", "o3", "o4")):
        return True
    if m.startswith("gpt-5"):
        # gpt-5-chat-latest 是兼容老 chat 接口的变体,支持 temperature
        return "chat" not in m
    return False


def build_chat_kwargs(
    *,
    model: str,
    messages: list[dict],
    stream: bool = False,
    temperature: float | None = None,
    response_format: dict | None = None,
    **extra,
) -> dict:
    """组装 OpenAI chat.completions.create() 的 kwargs,自动适配 reasoning 模型。

    - reasoning 模型: 静默丢弃 temperature / top_p / presence_penalty / frequency_penalty
    - 其他参数 (response_format, max_tokens 等) 原样透传
    - 任何 reasoning 模型不接受的 extra kwargs 也会被剔除
    """
    reasoning = is_reasoning_model(model)
    kwargs: dict = {"model": model, "messages": messages, "stream": stream}

    if not reasoning and temperature is not None:
        kwargs["temperature"] = temperature

    if response_format is not None:
        kwargs["response_format"] = response_format

    # 已知 reasoning 模型不接受的 sampling 参数,统一过滤
    _BLOCKED_FOR_REASONING = {
        "top_p",
        "presence_penalty",
        "frequency_penalty",
        "logit_bias",
        "logprobs",
        "top_logprobs",
    }
    for k, v in extra.items():
        if reasoning and k in _BLOCKED_FOR_REASONING:
            continue
        # max_tokens 在 reasoning 模型上需要改名为 max_completion_tokens
        if reasoning and k == "max_tokens":
            kwargs["max_completion_tokens"] = v
            continue
        kwargs[k] = v
    return kwargs


# 历史保留 — 部分内部代码可能在用
def _is_reasoning_model(model: str) -> bool:  # pragma: no cover
    return is_reasoning_model(model)


def _chat_create_kwargs(
    *,
    model: str,
    messages: list[dict],
    temperature: float,
    stream: bool,
) -> dict:
    return build_chat_kwargs(
        model=model, messages=messages, stream=stream, temperature=temperature
    )


async def stream_chat(
    messages: Iterable[dict[str, str]],
    *,
    tier: ModelTier | str | None = None,
    temperature: float = 0.5,
) -> AsyncIterator[str]:
    """以流的方式调用 OpenAI Chat Completions,yield 文本增量。"""
    client = get_client()
    model = resolve_model(tier)
    stream = await client.chat.completions.create(
        **_chat_create_kwargs(
            model=model,
            messages=list(messages),
            temperature=temperature,
            stream=True,
        ),
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield text


async def complete_chat(
    messages: Iterable[dict[str, str]],
    *,
    tier: ModelTier | str | None = None,
    temperature: float = 0.5,
) -> str:
    """非流式调用,返回完整文本。"""
    client = get_client()
    model = resolve_model(tier)
    resp = await client.chat.completions.create(
        **_chat_create_kwargs(
            model=model,
            messages=list(messages),
            temperature=temperature,
            stream=False,
        ),
    )
    return resp.choices[0].message.content or ""
