"""Agent 推理 runtime。

Phase 0 实现:
1. 根据 agent_type 加载 system prompt
2. 把学生画像注入 context (作为 system message 的补充)
3. 拼接历史对话
4. 调用 LLM 流式返回

Phase 1 扩展:
- 把 RAG 召回的资料片段作为额外 system message 注入
- 在 system prompt 中告诉 Agent 如何引用

后续 (Phase 2+):
- 工具调用 (update_progress / create_task ...)
- 输出后置处理(知识点抽取)
"""

from __future__ import annotations

from typing import AsyncIterator

from ..core.llm import ModelTier, stream_chat
from .registry import AgentConfig


_RAG_INSTRUCTION = (
    "学生本次提问引用了若干资料,见下方「# 学生提供的资料片段」。"
    "回答时:\n"
    "1. 优先基于这些资料片段,如果信息不够再使用通识知识;\n"
    "2. 使用资料时用 [1] [2] 之类的角标标注,角标与片段序号一一对应;\n"
    "3. 不要编造资料中没有的细节,如果资料无法回答,坦诚告诉学生;\n"
    "4. 末尾用一句话总结引用了哪些资料。"
)


def _format_profile_block(student_profile: dict | None) -> str:
    if not student_profile:
        return ""
    lines: list[str] = []
    if student_profile.get("name"):
        lines.append(f"- 学生昵称:{student_profile['name']}")
    if student_profile.get("grade"):
        lines.append(f"- 年级:{student_profile['grade']}")
    if student_profile.get("textbook_version"):
        lines.append(f"- 教材版本:{student_profile['textbook_version']}")
    if student_profile.get("target_exam"):
        lines.append(f"- 近期目标:{student_profile['target_exam']}")
    focus = student_profile.get("focus_subjects") or []
    if focus:
        lines.append(f"- 重点科目:{', '.join(focus)}")
    if student_profile.get("learning_goal"):
        lines.append(f"- 学习目标:{student_profile['learning_goal']}")
    return "\n\n# 当前学生信息\n" + "\n".join(lines) if lines else ""


def build_messages(
    *,
    agent: AgentConfig,
    history: list[dict],
    student_profile: dict | None,
    rag_context: str | None = None,
) -> list[dict]:
    """构造发给 LLM 的 messages 数组。

    rag_context: 已经 format 好的资料片段段落 (见 services.retrieval.format_context)。
    """
    system_prompt = agent.load_prompt()
    profile_block = _format_profile_block(student_profile)

    rag_block = ""
    if rag_context:
        rag_block = (
            "\n\n# 学生提供的资料片段\n"
            + rag_context
            + "\n\n# 引用规则\n"
            + _RAG_INSTRUCTION
        )

    messages: list[dict] = [
        {"role": "system", "content": system_prompt + profile_block + rag_block}
    ]
    for msg in history:
        role = msg.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = msg.get("content") or ""
        if not content:
            continue
        messages.append({"role": role, "content": content})
    return messages


async def stream_reply(
    *,
    agent: AgentConfig,
    history: list[dict],
    student_profile: dict | None,
    rag_context: str | None = None,
    temperature: float = 0.5,
    tier: ModelTier | None = None,
) -> AsyncIterator[str]:
    """流式调用 LLM,逐段返回文本。tier 优先 (学生临时覆盖),否则用 agent 默认。"""
    messages = build_messages(
        agent=agent,
        history=history,
        student_profile=student_profile,
        rag_context=rag_context,
    )
    effective_tier = tier or agent.tier
    async for delta in stream_chat(
        messages, tier=effective_tier, temperature=temperature
    ):
        yield delta
