"""Agent 推理 runtime。

Phase 0 实现:
1. 根据 agent_type 加载 system prompt
2. 把学生画像注入 context (作为 system message 的补充)
3. 拼接历史对话
4. 调用 LLM 流式返回

Phase 1+ 这里会扩展:
- RAG 资料召回
- 工具调用 (update_progress / create_task ...)
- 输出后置处理(知识点抽取)
"""

from __future__ import annotations

from typing import AsyncIterator

from ..core.llm import stream_chat
from .registry import AgentConfig


def build_messages(
    *,
    agent: AgentConfig,
    history: list[dict],
    student_profile: dict | None,
) -> list[dict]:
    """构造发给 LLM 的 messages 数组。"""
    system_prompt = agent.load_prompt()

    profile_lines: list[str] = []
    if student_profile:
        name = student_profile.get("name")
        grade = student_profile.get("grade")
        textbook = student_profile.get("textbook_version")
        target = student_profile.get("target_exam")
        goal = student_profile.get("learning_goal")
        focus = student_profile.get("focus_subjects") or []
        if name:
            profile_lines.append(f"- 学生昵称:{name}")
        if grade:
            profile_lines.append(f"- 年级:{grade}")
        if textbook:
            profile_lines.append(f"- 教材版本:{textbook}")
        if target:
            profile_lines.append(f"- 近期目标:{target}")
        if focus:
            profile_lines.append(f"- 重点科目:{', '.join(focus)}")
        if goal:
            profile_lines.append(f"- 学习目标:{goal}")

    profile_block = (
        "\n\n# 当前学生信息\n" + "\n".join(profile_lines) if profile_lines else ""
    )

    messages: list[dict] = [
        {"role": "system", "content": system_prompt + profile_block}
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
    temperature: float = 0.5,
) -> AsyncIterator[str]:
    """流式调用 LLM,逐段返回文本。"""
    messages = build_messages(
        agent=agent, history=history, student_profile=student_profile
    )
    async for delta in stream_chat(
        messages, tier=agent.tier, temperature=temperature
    ):
        yield delta
