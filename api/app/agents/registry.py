"""Agent 注册表 (Phase 5: 双源)。

设计原则:
- 保留 4 个内置老师的 hardcoded fallback,prompt 文件仍是权威 system_prompt
- 新增 DB 表 `user_agents`,4 个内置老师已 seed (system_prompt 为空,DB metadata 仅做展示)
- 用户可创建私有老师 → 全部存 DB

Lookup 优先级:
1. `resolve_agent(agent_key, owner_id)` 先查 DB (含归属/RLS 检查)
2. DB 命中 + system_prompt 非空 → 用 DB 的 prompt
3. DB 命中但 system_prompt 空 + 命中内置老师 → fallback 到 prompt 文件
4. DB miss + 命中内置老师 → 用 hardcoded 行为 (兼容旧 sessions)
5. 否则 KeyError
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from ..core.llm import ModelTier
from ..db import repos

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"


@dataclass(frozen=True)
class AgentConfig:
    agent_type: str
    display_name: str
    subject_id: str | None
    prompt_file: str | None = None
    tier: ModelTier = ModelTier.MEDIUM
    welcome_message: str = ""
    tools: tuple[str, ...] = field(default_factory=tuple)
    # Phase 5: 直接持有 prompt 字符串 (优先于 prompt_file)
    inline_system_prompt: str | None = None
    # Phase 5: 老师默认绑定的资料 ids,前端 MaterialPicker 进入会议时默认勾上
    default_material_ids: tuple[str, ...] = field(default_factory=tuple)
    # Phase 5: 老师自由领域 tags (用于 ui 展示与未来按 tag 自动绑定)
    domains: tuple[str, ...] = field(default_factory=tuple)
    # Phase 5: emoji / 简介 (现有 hardcoded 4 个老师没暴露,用于 ui 兜底)
    emoji: str = "🎓"
    tagline: str = ""
    role: str = ""
    starter_prompts: tuple[str, ...] = field(default_factory=tuple)
    # Phase 5: owner_type 区分平台 vs 用户老师 (前端展示用)
    owner_type: str = "platform"

    def load_prompt(self) -> str:
        if self.inline_system_prompt:
            return self.inline_system_prompt
        if self.prompt_file:
            path = PROMPTS_DIR / self.prompt_file
            return path.read_text(encoding="utf-8")
        return f"你是一个 AI 老师 ({self.display_name})。请用清晰友好的方式回答学生问题。"


# -----------------------------------------------------------------------------
# 4 个内置老师 — hardcoded fallback,保留 prompt 文件作为权威 system_prompt
# -----------------------------------------------------------------------------
_BUILTIN_AGENTS: dict[str, AgentConfig] = {
    "head_teacher": AgentConfig(
        agent_type="head_teacher",
        display_name="AI 班主任",
        subject_id=None,
        prompt_file="head_teacher.md",
        tier=ModelTier.MEDIUM,
        welcome_message=(
            "你好,我是你的 AI 班主任 👋\n\n"
            "我会帮你记录各科进度、发现薄弱点、安排学习任务。\n"
            "你可以先告诉我:你最近最想提升哪一科?最近一次考试哪里失分最多?"
        ),
        emoji="🧭",
        tagline="帮你做规划、汇总薄弱点、安排学习节奏",
        role="学习规划与全局诊断",
        starter_prompts=(
            "帮我看看这周怎么安排数学和英语",
            "下个月期中考试,帮我做个冲刺计划",
            "最近学习效率有点低,你能帮我分析吗?",
        ),
    ),
    "math_teacher": AgentConfig(
        agent_type="math_teacher",
        display_name="数学老师",
        subject_id="math",
        prompt_file="math_teacher.md",
        tier=ModelTier.MEDIUM,
        welcome_message=(
            "你好,我是 AI 数学老师。\n\n"
            "你可以问我:某个知识点不懂、一道题不会做、试卷怎么订正、考前怎么复习。\n"
            "我们一步一步来,先告诉我你最近在学什么章节?"
        ),
        emoji="📐",
        tagline="讲解概念、分步推导、引导独立思考",
        role="数学讲解与分步推导",
        starter_prompts=(
            "一次函数为什么是一条直线?",
            "我不会因式分解,帮我从头讲一下",
            "这道方程应用题怎么列式?",
        ),
    ),
    "english_teacher": AgentConfig(
        agent_type="english_teacher",
        display_name="英语老师",
        subject_id="english",
        prompt_file="english_teacher.md",
        tier=ModelTier.MEDIUM,
        welcome_message=(
            "Hi! I'm your AI English teacher. 你可以中文或英文跟我聊。\n\n"
            "我能帮你:讲语法、改作文、分析阅读、讲单词。\n"
            "先告诉我:你最近想搞清楚哪个语法点,或者哪篇阅读卡住了?"
        ),
        emoji="✍️",
        tagline="讲语法、改作文、分析阅读、讲单词",
        role="英语语法、阅读与作文",
        starter_prompts=(
            "现在完成时和一般过去时有什么区别?",
            "帮我改一下这段英语作文",
            "这篇阅读为什么选 B?",
        ),
    ),
    "chinese_teacher": AgentConfig(
        agent_type="chinese_teacher",
        display_name="语文老师",
        subject_id="chinese",
        prompt_file="chinese_teacher.md",
        tier=ModelTier.MEDIUM,
        welcome_message=(
            "你好,我是 AI 语文老师。\n\n"
            "现代文、文言文、古诗词、作文都可以问我。\n"
            "你想从哪一块开始?或者先把你近期的题目/作文片段发给我看看。"
        ),
        emoji="📖",
        tagline="阅读理解、文言文、古诗词、作文构思",
        role="语文阅读、文言与作文",
        starter_prompts=(
            "这篇阅读的中心思想是什么?",
            "文言文这句话怎么翻译?",
            "作文怎么开头更好?",
        ),
    ),
}


@lru_cache(maxsize=1)
def all_builtin_agents() -> tuple[AgentConfig, ...]:
    """4 个内置老师 (向后兼容,无 DB 时仍可用)。"""
    return tuple(_BUILTIN_AGENTS.values())


# 旧别名 — task_planner / routes 仍在用
all_agents = all_builtin_agents


def get_agent(agent_type: str) -> AgentConfig:
    """老路径:仅在内置老师里查 (不访问 DB)。保留供 worker / 单测用。

    对于 chat / route 等需要支持用户自定义老师的场景,改调 `resolve_agent`.
    """
    if agent_type not in _BUILTIN_AGENTS:
        raise KeyError(f"未注册的 agent_type: {agent_type}")
    return _BUILTIN_AGENTS[agent_type]


# -----------------------------------------------------------------------------
# Phase 5: DB-aware resolver
# -----------------------------------------------------------------------------
def _agent_from_db_row(row: dict) -> AgentConfig:
    key = row["agent_key"]
    # 平台老师 + prompt 文件存在 → 用文件做权威 prompt;否则用 DB 字段
    builtin = _BUILTIN_AGENTS.get(key)
    inline_prompt = (row.get("system_prompt") or "").strip() or None
    prompt_file = builtin.prompt_file if builtin and not inline_prompt else None

    try:
        tier = ModelTier(row.get("default_model_tier") or "medium")
    except ValueError:
        tier = ModelTier.MEDIUM

    starter_prompts = tuple(row.get("starter_prompts") or ())
    if not starter_prompts and builtin:
        starter_prompts = builtin.starter_prompts

    default_material_ids = tuple(row.get("default_material_ids") or ())
    domains = tuple(row.get("domains") or ())

    welcome = builtin.welcome_message if builtin else ""

    return AgentConfig(
        agent_type=key,
        display_name=row.get("display_name") or (builtin.display_name if builtin else key),
        subject_id=row.get("subject_id") or (builtin.subject_id if builtin else None),
        prompt_file=prompt_file,
        tier=tier,
        welcome_message=welcome,
        inline_system_prompt=inline_prompt,
        default_material_ids=default_material_ids,
        domains=domains,
        emoji=row.get("emoji") or (builtin.emoji if builtin else "🎓"),
        tagline=row.get("tagline") or (builtin.tagline if builtin else ""),
        role=row.get("role") or (builtin.role if builtin else ""),
        starter_prompts=starter_prompts,
        owner_type=row.get("owner_type") or "platform",
    )


def resolve_agent(agent_key: str, owner_id: str | None = None) -> AgentConfig:
    """主入口:支持自定义老师 + 内置老师 fallback。

    - owner_id=None: 不做归属检查 (内部/管理调用),仅按 key 查
    - owner_id=<uuid>: 平台老师任意可见,user 老师必须 owner 一致

    Resiliency: 当 DB 不可达 (网络超时 / supabase 短暂挂掉) 时,
    内置老师走 hardcoded fallback;否则才抛 RuntimeError。
    用户老师不命中或被软删除,会回退到 builtin (如果是内置 key) 或抛 KeyError。
    """
    row: dict | None = None
    db_failed = False
    try:
        row = repos.get_user_agent_by_key(agent_key, owner_id=owner_id)
    except Exception as exc:  # pragma: no cover — supabase 抖动 / 网络问题
        db_failed = True
        logger.warning(
            "resolve_agent(%s) DB lookup failed: %s. 尝试 builtin fallback.",
            agent_key,
            exc,
        )

    if row is not None and row.get("is_active", True):
        # is_active=False 视作 soft-deleted;旧 session 仍能从 builtin fallback 读
        return _agent_from_db_row(row)

    if agent_key in _BUILTIN_AGENTS:
        return _BUILTIN_AGENTS[agent_key]

    if db_failed:
        # 用户自定义老师 + DB 挂了 → 没法 fallback,直接报错让上层提示
        raise RuntimeError(
            f"老师 {agent_key} 暂时无法加载 (DB 不可达),请稍后重试"
        )
    raise KeyError(f"未注册的 agent_key: {agent_key}")
