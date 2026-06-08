"""Agent 注册表。

每个 Agent 是一份配置:
- agent_type:唯一标识,与数据库中的 chat_sessions.agent_type 对齐
- display_name:前端展示用
- subject_id:绑定的科目,班主任不绑定具体科目
- prompt_file:相对 prompts/ 目录的文件名
- tier:默认使用哪一档模型 (ModelTier)

Phase 0 还不引入工具调用,工具列表先留空,Phase 1+ 再扩展。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from ..core.llm import ModelTier

PROMPTS_DIR = Path(__file__).parent / "prompts"


@dataclass(frozen=True)
class AgentConfig:
    agent_type: str
    display_name: str
    subject_id: str | None
    prompt_file: str
    tier: ModelTier = ModelTier.DEFAULT
    welcome_message: str = ""
    tools: tuple[str, ...] = field(default_factory=tuple)

    def load_prompt(self) -> str:
        path = PROMPTS_DIR / self.prompt_file
        return path.read_text(encoding="utf-8")


_AGENTS: dict[str, AgentConfig] = {
    "head_teacher": AgentConfig(
        agent_type="head_teacher",
        display_name="AI 班主任",
        subject_id=None,
        prompt_file="head_teacher.md",
        tier=ModelTier.DEFAULT,
        welcome_message=(
            "你好,我是你的 AI 班主任 👋\n\n"
            "我会帮你记录各科进度、发现薄弱点、安排学习任务。\n"
            "你可以先告诉我:你最近最想提升哪一科?最近一次考试哪里失分最多?"
        ),
    ),
    "math_teacher": AgentConfig(
        agent_type="math_teacher",
        display_name="数学老师",
        subject_id="math",
        prompt_file="math_teacher.md",
        tier=ModelTier.DEFAULT,
        welcome_message=(
            "你好,我是 AI 数学老师。\n\n"
            "你可以问我:某个知识点不懂、一道题不会做、试卷怎么订正、考前怎么复习。\n"
            "我们一步一步来,先告诉我你最近在学什么章节?"
        ),
    ),
    "english_teacher": AgentConfig(
        agent_type="english_teacher",
        display_name="英语老师",
        subject_id="english",
        prompt_file="english_teacher.md",
        tier=ModelTier.DEFAULT,
        welcome_message=(
            "Hi! I'm your AI English teacher. 你可以中文或英文跟我聊。\n\n"
            "我能帮你:讲语法、改作文、分析阅读、讲单词。\n"
            "先告诉我:你最近想搞清楚哪个语法点,或者哪篇阅读卡住了?"
        ),
    ),
    "chinese_teacher": AgentConfig(
        agent_type="chinese_teacher",
        display_name="语文老师",
        subject_id="chinese",
        prompt_file="chinese_teacher.md",
        tier=ModelTier.DEFAULT,
        welcome_message=(
            "你好,我是 AI 语文老师。\n\n"
            "现代文、文言文、古诗词、作文都可以问我。\n"
            "你想从哪一块开始?或者先把你近期的题目/作文片段发给我看看。"
        ),
    ),
}


@lru_cache(maxsize=1)
def all_agents() -> tuple[AgentConfig, ...]:
    return tuple(_AGENTS.values())


def get_agent(agent_type: str) -> AgentConfig:
    if agent_type not in _AGENTS:
        raise KeyError(f"未注册的 agent_type: {agent_type}")
    return _AGENTS[agent_type]
