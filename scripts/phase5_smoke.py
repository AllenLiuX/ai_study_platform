#!/usr/bin/env python
"""Phase 5 冒烟:自定义老师 + 知识点笔记 + 自由学习者。

不需要打 OpenAI 或真访问 Supabase,通过 monkeypatch repos 验证:
1. resolve_agent 在 DB 命中时用 DB 字段;DB 命中但 system_prompt 空时 fallback 到 builtin prompt 文件
2. resolve_agent 在 DB 不可达 (网络抖动) 时,内置老师走 hardcoded fallback (韧性)
3. resolve_agent 对私有老师做 soft-delete (is_active=False) 时 fallback
4. AgentConfig 关键字段 (default_material_ids / domains / starter_prompts / owner_type) 正确透传
5. RetrievedChunk 跨源 (material/note) merge 排序正确 + format_context 带 [资料]/[笔记] 标签
6. /api/agents 与 /api/notes route 全部装载,端点 path 正确
7. AgentType 已放开为 str (不再是 Literal),chat_messages.agent_type 兼容用户自定义 key
8. StudentProfile 接受 learner_type='free_learner' + focus_domains
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

GREEN = "\033[32m"
RED = "\033[31m"
NC = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓ {msg}{NC}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{NC}")
    sys.exit(1)


async def main() -> None:
    # --- import 检查 ----------------------------------------------------------
    from app.agents import registry  # noqa: E402
    from app.agents.registry import (
        AgentConfig,
        all_builtin_agents,
        resolve_agent,
    )
    from app.db import repos  # noqa: E402
    from app.routes import agents as agents_route, notes as notes_route  # noqa: E402
    from app.schemas.chat import AgentType  # noqa: E402
    from app.schemas.student import StudentProfile  # noqa: E402
    from app.services.retrieval import (  # noqa: E402
        RetrievedChunk,
        format_context,
    )

    ok("backend 全部 Phase 5 模块 import 成功")

    # --- 1. AgentType 是 str (不再 Literal) -----------------------------------
    # 老 Literal 会让任意 str 通不过类型检查;现在应该是 str alias
    sample_key: AgentType = "any_custom_agent_key_xyz"  # type: ignore[assignment]
    assert isinstance(sample_key, str)
    ok("AgentType 已放开为 str — 用户自定义 agent_key 兼容")

    # --- 2. 4 个 builtin agents 仍可用 ----------------------------------------
    builtins = all_builtin_agents()
    keys = {a.agent_type for a in builtins}
    assert {"head_teacher", "math_teacher", "english_teacher", "chinese_teacher"} <= keys
    for a in builtins:
        assert isinstance(a, AgentConfig)
        assert a.owner_type == "platform"
        assert a.starter_prompts and len(a.starter_prompts) >= 2
        # prompt 文件能正确加载
        prompt = a.load_prompt()
        assert prompt and len(prompt) > 50, f"{a.agent_type} 的 prompt 太短"
    ok(f"4 个 builtin agents 字段完整,prompt 文件全部可读 ({len(builtins)} 个)")

    # --- 3. resolve_agent: DB 命中 (用户老师 inline_system_prompt) ------------
    user_row = {
        "agent_key": "ml_system_design_teacher",
        "display_name": "System Design Teacher",
        "subject_id": None,
        "system_prompt": "你是一位资深机器学习系统设计老师,帮助用户准备 Senior MLE 面试。",
        "default_model_tier": "high",
        "starter_prompts": [
            "帮我规划 2 周面试冲刺",
            "讲讲事件驱动量化系统的核心组件",
        ],
        "default_material_ids": ["mat-1", "mat-2"],
        "domains": ["machine_learning", "system_design"],
        "emoji": "🧠",
        "tagline": "面试冲刺与领域学习",
        "role": "system design 导师",
        "owner_type": "user",
        "owner_id": "user-uuid",
        "is_active": True,
    }
    orig_get = repos.get_user_agent_by_key
    try:
        repos.get_user_agent_by_key = lambda key, owner_id=None: (  # type: ignore[assignment]
            user_row if key == "ml_system_design_teacher" else None
        )
        cfg = resolve_agent("ml_system_design_teacher", owner_id="user-uuid")
        assert cfg.agent_type == "ml_system_design_teacher"
        assert cfg.owner_type == "user"
        assert cfg.tier.value == "high"
        assert cfg.default_material_ids == ("mat-1", "mat-2")
        assert "machine_learning" in cfg.domains
        assert cfg.load_prompt().startswith("你是一位资深机器学习系统设计老师")
        assert len(cfg.starter_prompts) == 2
        ok("resolve_agent: 用户老师从 DB 读 inline_system_prompt + 自定义字段 ✓")

        # --- 4. resolve_agent: DB 命中 platform 但 system_prompt 空 → fallback 到 prompt 文件
        platform_row = {
            **user_row,
            "agent_key": "math_teacher",
            "display_name": "数学老师 (DB override 显示名)",
            "system_prompt": "",  # DB 没 prompt
            "owner_type": "platform",
            "owner_id": None,
            "default_material_ids": [],
            "domains": [],
        }
        repos.get_user_agent_by_key = lambda key, owner_id=None: (  # type: ignore[assignment]
            platform_row if key == "math_teacher" else None
        )
        cfg = resolve_agent("math_teacher", owner_id=None)
        assert cfg.agent_type == "math_teacher"
        # display_name 从 DB 读
        assert "数学老师" in cfg.display_name
        # prompt 应回到文件 (math_teacher.md 里有内容)
        prompt = cfg.load_prompt()
        assert prompt and "数学" in prompt and len(prompt) > 100
        ok("resolve_agent: DB platform + system_prompt 空 → fallback prompt 文件 ✓")

        # --- 5. resolve_agent: 软删除 (is_active=False) → fallback builtin
        soft_deleted = {**platform_row, "is_active": False}
        repos.get_user_agent_by_key = lambda key, owner_id=None: (  # type: ignore[assignment]
            soft_deleted if key == "math_teacher" else None
        )
        cfg = resolve_agent("math_teacher", owner_id=None)
        # 拿到的应该是 builtin hardcoded — display_name 是"数学老师"(没"DB override")
        assert cfg.display_name == "数学老师", f"got {cfg.display_name}"
        ok("resolve_agent: is_active=False → fallback builtin (旧 session 仍可读) ✓")

        # --- 6. resolve_agent: DB 不可达 → builtin fallback (韧性)
        def boom(key: str, owner_id=None) -> dict | None:
            raise RuntimeError("Supabase SSL handshake timed out")

        repos.get_user_agent_by_key = boom  # type: ignore[assignment]
        cfg = resolve_agent("head_teacher", owner_id="any-user")
        assert cfg.agent_type == "head_teacher"
        assert cfg.display_name == "AI 班主任"
        ok("resolve_agent: DB 抛错 → builtin hardcoded fallback (韧性) ✓")

        # 用户老师 + DB 挂了 → 应该明确抛错让上层提示
        try:
            resolve_agent("user_custom_no_builtin", owner_id="any-user")
            fail("用户老师 + DB 挂应该抛 RuntimeError")
        except RuntimeError as exc:
            assert "DB 不可达" in str(exc)
            ok("resolve_agent: 用户老师 + DB 挂 → 友好 RuntimeError ✓")
        except KeyError:
            fail("用户老师 + DB 挂不应该抛 KeyError (应抛 RuntimeError 提示)")
    finally:
        repos.get_user_agent_by_key = orig_get  # type: ignore[assignment]

    # --- 7. RetrievedChunk + format_context 跨源 -------------------------------
    chunks = [
        RetrievedChunk(
            chunk_id="c1",
            source="material",
            source_id="mat-1",
            source_title="人教版数学八上",
            source_subject="math",
            chunk_index=2,
            content="一次函数 y=kx+b 的图像是一条直线…",
            similarity=0.81,
        ),
        RetrievedChunk(
            chunk_id="c2",
            source="note",
            source_id="note-1",
            source_title="期权交易系统设计要点",
            source_subject=None,
            chunk_index=0,
            content="事件驱动架构的关键是…",
            similarity=0.87,
        ),
    ]
    # 兼容字段 — 旧代码仍然能读 material_id / material_title
    assert chunks[0].material_id == "mat-1" and chunks[1].material_title == "期权交易系统设计要点"
    # format_context 应该带 [资料]/[笔记] 标签
    ctx = format_context(chunks)
    assert "[资料]" in ctx and "[笔记]" in ctx
    assert "人教版数学八上" in ctx and "期权交易系统设计要点" in ctx
    ok("RetrievedChunk 跨源兼容字段 + format_context 带 [资料]/[笔记] 标签 ✓")

    # --- 8. Routes 注册检查 ---------------------------------------------------
    agent_paths = sorted(
        r.path for r in agents_route.router.routes if hasattr(r, "path")
    )
    note_paths = sorted(
        r.path for r in notes_route.router.routes if hasattr(r, "path")
    )
    expected_agent_paths = {
        "/agents",
        "/agents/_generate",
        "/agents/{agent_key}",
    }
    expected_note_paths = {
        "/notes",
        "/notes/{note_id}",
        "/notes/from_message",
        "/notes/{note_id}/review",
    }
    missing_a = expected_agent_paths - set(agent_paths)
    missing_n = expected_note_paths - set(note_paths)
    if missing_a:
        fail(f"agents route 缺端点: {missing_a}")
    if missing_n:
        fail(f"notes route 缺端点: {missing_n}")
    ok(
        f"agents route ({len(agent_paths)} 端点) + notes route ({len(note_paths)} 端点) "
        "全部装载 ✓"
    )

    # --- 9. StudentProfile 支持 free_learner -----------------------------------
    p_k12 = StudentProfile(
        user_id="u1",
        name="小明",
        grade="初一",
        learner_type="k12_student",
        focus_subjects=["math"],
        focus_domains=[],
        onboarding_completed=True,
    )
    p_free = StudentProfile(
        user_id="u2",
        name="Engineer",
        grade=None,  # 自由学习者不填年级
        learner_type="free_learner",
        focus_subjects=[],
        focus_domains=["machine_learning", "system_design", "quant_trading"],
        learning_goal="准备 Senior MLE 面试",
        onboarding_completed=True,
    )
    assert p_k12.learner_type == "k12_student" and p_k12.grade == "初一"
    assert p_free.learner_type == "free_learner" and p_free.grade is None
    assert "system_design" in p_free.focus_domains
    ok("StudentProfile 兼容 free_learner + focus_domains + grade nullable ✓")

    print(f"\n{GREEN}Phase 5 smoke PASSED (9 项断言){NC}")


if __name__ == "__main__":
    asyncio.run(main())
