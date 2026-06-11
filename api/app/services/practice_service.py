"""Phase 6: 练习模块 service。

职责:
- 创建练习 session (含 LLM 生成 plan)
- 出下一题 (基于已答题历史 + 难度策略)
- 判题 (mcq/fill 本地;short 用 LLM 评分)
- 给提示 (Socratic style)
- 结束 + 生成 markdown 总结
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import HTTPException
from openai import APIError as OpenAIAPIError

from ..agents.registry import resolve_agent
from ..core.llm import (
    ModelTier,
    build_chat_kwargs,
    get_client,
    is_reasoning_model,
    resolve_model,
)
from ..db import repos

logger = logging.getLogger(__name__)


# =============================================================================
# Prompts
# =============================================================================

_PLAN_SYSTEM = """你是 AI 学习平台的「练习规划助手」。
学生指定了一个练习主题 + 时长 + 题量,你要给出一份简短的练习计划。

请输出 JSON,字段:
- plan_markdown: 一段 markdown 简述(≤ 200 字)
  · 这个主题适合用什么策略练
  · 建议拆分成哪些子知识点 (3-6 个)
  · 学生练完后能掌握什么
- knowledge_points: 子知识点列表 (string[],3-6 个,出题时用)

不要 markdown 代码块包裹,只输出纯 JSON。
"""

_QUESTION_SYSTEM_TEMPLATE = """你是 {agent_name}({agent_role})。
正在带学生练习「{topic}」。

你已经出过这些题(题目/答案/学生作答/对错;若有):
{history_block}

现在请出第 {next_idx} 道题。

要求:
- 题型必须从这里选:{kinds_csv}
- 难度:{difficulty_label}(1=入门 / 5=很难)
- 知识点:从「{kp_csv}」里挑(可以是组合,可以是没出过的优先)
- 题目要具体、可判定。不要空泛的"谈谈你对 XX 的看法"
- 若是 mcq:严格 4 个选项,只有 1 个正确;选项要有迷惑性 (避免明显错误)
- 若是 multi_mcq:4 个选项,2-3 个正确
- 若是 fill:答案应当唯一或几乎唯一;答案放进 `answer` 数组,可放多种等价拼写
- 若是 short:要求学生用 ≤ 100 字作答;在 `answer` 里给 rubric (评分要点 3-5 条) + reference (标准答案 ≤ 200 字)

请严格输出 JSON,不要 markdown 代码块包裹。字段:
{{
  "kind": "mcq" | "multi_mcq" | "fill" | "short",
  "prompt": "题目 markdown,可含 LaTeX",
  "options": [{{"id":"A","text":"..."}}, ...] | null,
  "answer": ... ,
  "explanation": "解析,讲明白原理 + 易错点,≤ 300 字",
  "difficulty": 1-5,
  "knowledge_points": ["..."],
  "hints": ["第1次提示(最轻)", "第2次提示", "第3次提示(最重,但仍不直接给答案)"]
}}
"""

_HINT_SYSTEM = """你是 AI 老师,正在带学生做练习题。学生在做下面这道题,需要提示。

题目:
{prompt}

学生当前的尝试(若有):
{user_answer}

已经给过的提示数:{prior_hint_count}

要求:
- 这是第 {hint_level} 次提示,你要给比之前更具体一些,但**绝不能直接给答案**
- 用 Socratic 风格:抛出一个引导性问题 / 拆解一个子步骤 / 指出一个关键概念
- 不超过 80 字,markdown 简洁
- 只输出提示文本,不要前缀如"提示:"
"""

_SHORT_JUDGE_SYSTEM = """你是 AI 学习平台的「简答题评分助手」。
学生写了一段简答,你要按 rubric 评分 + 给反馈。

题目:
{prompt}

评分要点 (rubric):
{rubric}

参考答案:
{reference}

学生回答:
{user_answer}

请严格输出 JSON,不要 markdown 包裹。字段:
{{
  "score": 0-10 的数字 (整数或 0.5 精度),
  "is_correct": true/false (≥ 6 算 true),
  "feedback": "≤ 150 字的评语,先肯定再指出不足,最后给一句改进建议"
}}
"""

_SUMMARY_SYSTEM = """你是 AI 学习平台的「练习复盘助手」。
学生刚完成一次练习,请你写一份简短的复盘 markdown。

练习主题:{topic}
练习老师:{agent_name}
作答统计:共 {answered} 题,答对 {correct},正确率 {accuracy}%。

逐题数据(题型/难度/知识点/对错/简答评分):
{rows_block}

请输出 markdown(≤ 800 字),包含三段:
## 表现速览
一段 ≤ 80 字的概括,夸优点 + 点不足。

## 强弱知识点
列表形式:
- ✅ 掌握不错的知识点:...
- ⚠️ 需要加强的知识点:...

## 下一步建议
- 推荐复习哪些知识点 (具体)
- 推荐下一次练什么(衔接主题)

只输出 markdown,不要 JSON。
"""


# =============================================================================
# 辅助:JSON 解析容错 / 难度策略
# =============================================================================


def _safe_load_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, flags=re.S | re.I)
    if fence_match:
        text = fence_match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _difficulty_label(strategy: str, history_correct: list[bool | None]) -> tuple[int, str]:
    """返回 (推荐难度 1-5, 给 LLM 的难度描述字符串)。"""
    if strategy.startswith("fixed_"):
        d = int(strategy.split("_")[1])
        return d, f"固定 {d} 级"

    # adaptive:看最近 3 题表现
    recent = [c for c in history_correct[-3:] if c is not None]
    if not recent:
        return 3, "3 (中等,作为基线)"
    correct_ratio = sum(1 for c in recent if c) / len(recent)
    if correct_ratio >= 0.8:
        return 4, "4 (学生最近表现好,升一档)"
    if correct_ratio <= 0.34:
        return 2, "2 (学生最近有挫败,降一档铺垫基础)"
    return 3, "3 (维持中等难度)"


# =============================================================================
# Step 1: 创建 session
# =============================================================================


async def create_session(*, owner_id: str, payload: dict) -> dict:
    """创建练习 + 让老师 LLM 生成 plan + knowledge_points 列表。"""
    # 校验 agent 存在(借助 resolve_agent 韧性 fallback)
    try:
        agent = resolve_agent(payload["agent_key"], owner_id=owner_id)
    except (KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"老师不可用:{exc}")

    # LLM 生成 plan (失败不阻塞,session 可以无 plan)
    plan_markdown = ""
    knowledge_points: list[str] = []
    try:
        plan_markdown, knowledge_points = await _generate_plan(
            agent=agent,
            topic=payload["topic"],
            target_minutes=payload["target_minutes"],
            target_question_count=payload["target_question_count"],
            tier=payload["model_tier"],
        )
    except Exception as exc:
        logger.warning("plan generation failed: %s", exc)

    fields = {
        "agent_key": payload["agent_key"],
        "topic": payload["topic"],
        "plan": plan_markdown or None,
        "target_minutes": payload["target_minutes"],
        "target_question_count": payload["target_question_count"],
        "allowed_kinds": payload["allowed_kinds"],
        "difficulty_strategy": payload["difficulty_strategy"],
        "model_tier": payload["model_tier"],
        "summary": {"knowledge_points_pool": knowledge_points} if knowledge_points else None,
    }
    session = repos.create_practice_session(owner_id, fields)
    return session


async def _generate_plan(
    *, agent, topic: str, target_minutes: int, target_question_count: int, tier: str
) -> tuple[str, list[str]]:
    client = get_client()
    model = resolve_model(ModelTier(tier))
    user_msg = (
        f"主题:{topic}\n"
        f"时长:{target_minutes} 分钟\n"
        f"题量:{target_question_count} 题\n"
        f"出题老师:{agent.display_name}({agent.role or ''})"
    )
    resp = await client.chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[
                {"role": "system", "content": _PLAN_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
    )
    text = (resp.choices[0].message.content or "").strip()
    data = _safe_load_json(text)
    plan_md = str(data.get("plan_markdown") or "").strip()
    kps = [str(k).strip() for k in (data.get("knowledge_points") or []) if str(k).strip()]
    return plan_md, kps[:10]


# =============================================================================
# Step 2: 出下一题
# =============================================================================


async def get_or_create_next_question(*, owner_id: str, session_id: str) -> dict:
    """如果有「最新一题但学生还没作答」,直接返回那题;否则生成新题。"""
    session = repos.get_practice_session(session_id, owner_id)
    if not session:
        raise HTTPException(status_code=404, detail="练习不存在")
    if session.get("status") != "active":
        raise HTTPException(status_code=400, detail="练习已结束,无法继续出题")

    questions = repos.list_practice_questions(session_id)
    attempts_by_qid = _attempts_index(questions)

    # 如果有"挂着的题"(出了但没作答 / 没跳过)→ 直接返回
    if questions:
        last = questions[-1]
        if last["id"] not in attempts_by_qid:
            return _question_for_client(last)

    # 已达到题量上限
    if len(questions) >= session.get("target_question_count", 10):
        raise HTTPException(
            status_code=409,
            detail={"complete": True, "reason": "已达到目标题量,请结束练习"},
        )

    # 生成下一题
    next_idx = len(questions) + 1
    new_q = await _llm_generate_question(
        session=session,
        history_questions=questions,
        attempts_by_qid=attempts_by_qid,
        next_idx=next_idx,
    )
    row = repos.insert_practice_question({"session_id": session_id, **new_q, "idx": next_idx})
    return _question_for_client(row)


def _attempts_index(questions: list[dict]) -> dict[str, dict]:
    if not questions:
        return {}
    attempts = repos.list_practice_attempts([q["id"] for q in questions])
    # 同一 question_id 取最新一条
    out: dict[str, dict] = {}
    for a in attempts:
        out[a["question_id"]] = a
    return out


async def _llm_generate_question(
    *,
    session: dict,
    history_questions: list[dict],
    attempts_by_qid: dict[str, dict],
    next_idx: int,
) -> dict:
    """让 agent LLM 出新题。"""
    try:
        agent = resolve_agent(session["agent_key"], owner_id=session["owner_id"])
    except (KeyError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"老师不可用:{exc}")

    history_correct = [
        (attempts_by_qid.get(q["id"]) or {}).get("is_correct") for q in history_questions
    ]
    difficulty, diff_label = _difficulty_label(
        session["difficulty_strategy"], history_correct
    )

    kp_pool = ((session.get("summary") or {}).get("knowledge_points_pool")) or []
    covered = set()
    for q in history_questions:
        for kp in q.get("knowledge_points") or []:
            covered.add(kp)
    uncovered = [k for k in kp_pool if k not in covered]
    # 给 LLM 提示优先没碰过的子知识点;若都覆盖了,允许 LLM 自由发挥
    kp_hint = uncovered or kp_pool or [session["topic"]]

    history_block = _format_history_for_prompt(history_questions, attempts_by_qid)

    sys_prompt = _QUESTION_SYSTEM_TEMPLATE.format(
        agent_name=agent.display_name,
        agent_role=agent.role or "学习导师",
        topic=session["topic"],
        history_block=history_block or "(还没出过题)",
        next_idx=next_idx,
        kinds_csv=", ".join(session["allowed_kinds"]),
        difficulty_label=diff_label,
        kp_csv=", ".join(kp_hint),
    )

    client = get_client()
    model = resolve_model(ModelTier(session["model_tier"]))
    try:
        resp = await client.chat.completions.create(
            **build_chat_kwargs(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": f"请出第 {next_idx} 道题。"},
                ],
                temperature=0.5 if not is_reasoning_model(model) else None,
                response_format={"type": "json_object"},
            )
        )
    except OpenAIAPIError as exc:
        logger.warning("question gen failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"出题失败:{exc}")

    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception as exc:
        logger.warning("question json parse failed: %s\n%s", exc, text[:400])
        raise HTTPException(status_code=502, detail="出题输出格式异常,请重试")

    kind = data.get("kind") or "mcq"
    if kind not in session["allowed_kinds"]:
        # LLM 偏轨了 — 兜底改成允许列表第一个
        kind = session["allowed_kinds"][0]

    prompt_text = str(data.get("prompt") or "").strip()
    if not prompt_text:
        raise HTTPException(status_code=502, detail="出题缺少 prompt")

    options = data.get("options") if kind in ("mcq", "multi_mcq") else None
    answer = data.get("answer")
    if answer is None or (isinstance(answer, (list, dict)) and not answer):
        raise HTTPException(status_code=502, detail="出题缺少 answer")

    explanation = str(data.get("explanation") or "").strip() or None
    diff = int(data.get("difficulty") or difficulty)
    diff = max(1, min(5, diff))
    kps = [str(k).strip() for k in (data.get("knowledge_points") or []) if str(k).strip()]
    if not kps:
        kps = kp_hint[:2]  # 兜底用提示的 kp
    hints = [
        str(h).strip()
        for h in (data.get("hints") or [])
        if str(h).strip()
    ][:5]

    return {
        "kind": kind,
        "prompt": prompt_text,
        "options": options,
        "answer": answer,
        "explanation": explanation,
        "difficulty": diff,
        "knowledge_points": kps,
        "source": "agent",
        "hints": hints,
    }


def _format_history_for_prompt(
    questions: list[dict], attempts_by_qid: dict[str, dict]
) -> str:
    if not questions:
        return ""
    parts = []
    for q in questions[-6:]:  # 最近 6 道,避免 prompt 爆掉
        attempt = attempts_by_qid.get(q["id"]) or {}
        verdict = (
            "✓ 答对"
            if attempt.get("is_correct") is True
            else ("✗ 答错" if attempt.get("is_correct") is False else "(未答 / 简答待评)")
        )
        if attempt.get("skipped"):
            verdict = "(跳过)"
        kp = ", ".join(q.get("knowledge_points") or []) or "-"
        parts.append(
            f"- 第 {q['idx']} 题 [{q['kind']}, 难度 {q['difficulty']}, 知识点 {kp}]: {verdict}"
        )
    return "\n".join(parts)


def _question_for_client(row: dict) -> dict:
    """从 DB 行剥掉 answer,准备给客户端的 question 视图。"""
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "idx": row["idx"],
        "kind": row["kind"],
        "prompt": row["prompt"],
        "options": row.get("options"),
        "explanation": None,  # 答完才暴露
        "difficulty": row["difficulty"],
        "knowledge_points": row.get("knowledge_points") or [],
        "source": row.get("source") or "agent",
        "hints": [],  # hints 也按需吐 (调 hint endpoint 才给)
        "created_at": row.get("created_at"),
    }


# =============================================================================
# Step 3: 判题
# =============================================================================


def _normalize_str(s: str) -> str:
    return re.sub(r"\s+", "", (s or "")).strip().lower()


async def submit_attempt(
    *,
    owner_id: str,
    question_id: str,
    user_answer: Any,
    skipped: bool,
    time_spent_ms: int | None,
    hints_used: int,
) -> dict:
    question = repos.get_practice_question(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")
    session = repos.get_practice_session(question["session_id"], owner_id)
    if not session:
        raise HTTPException(status_code=403, detail="无权访问")
    if session["status"] != "active":
        raise HTTPException(status_code=400, detail="练习已结束")

    kind = question["kind"]
    correct_answer = question["answer"]
    is_correct: bool | None = None
    score: float | None = None
    feedback: str | None = None

    if skipped:
        is_correct = None
    elif kind == "mcq":
        # answer 是 "A";user_answer 也是 "A"
        is_correct = _normalize_str(str(user_answer or "")) == _normalize_str(str(correct_answer))
    elif kind == "multi_mcq":
        # answer 是 ["A","C"];user_answer 也是 list
        ans_set = {_normalize_str(str(x)) for x in (correct_answer or [])}
        usr_set = {_normalize_str(str(x)) for x in (user_answer or [])}
        is_correct = ans_set == usr_set
    elif kind == "fill":
        # answer 是 ["LRU","Least Recently Used"]
        candidates = correct_answer if isinstance(correct_answer, list) else [correct_answer]
        usr = _normalize_str(str(user_answer or ""))
        if not usr:
            is_correct = False
        else:
            is_correct = any(_normalize_str(str(c)) == usr for c in candidates)
            # 本地失败 → 调 LLM 兜底判定语义等价(避免学生写了等价同义词被判错)
            if not is_correct:
                try:
                    is_correct = await _llm_judge_fill(
                        question=question, user_answer=str(user_answer)
                    )
                except Exception as exc:
                    logger.warning("LLM fill judge failed: %s", exc)
    elif kind == "short":
        score, is_correct, feedback = await _llm_judge_short(
            question=question, user_answer=str(user_answer or "")
        )
    else:
        raise HTTPException(status_code=500, detail=f"未知题型:{kind}")

    attempt = repos.insert_practice_attempt(
        {
            "question_id": question_id,
            "user_answer": user_answer if not skipped else None,
            "is_correct": is_correct,
            "score": score,
            "feedback": feedback,
            "skipped": skipped,
            "time_spent_ms": time_spent_ms,
            "hints_used": hints_used,
        }
    )
    return {
        "attempt": attempt,
        "correct_answer": correct_answer,
        "explanation": question.get("explanation"),
        "knowledge_points": question.get("knowledge_points") or [],
    }


async def _llm_judge_fill(*, question: dict, user_answer: str) -> bool:
    """对 fill 题,本地字符串失败后用 LLM 判定语义等价。"""
    candidates = question["answer"]
    if not isinstance(candidates, list):
        candidates = [candidates]
    candidates_text = " / ".join(str(c) for c in candidates)
    sys = (
        "你是一个填空题判定助手。"
        "学生填的答案如果跟参考答案语义等价(同义词 / 同义缩写 / 等价写法),输出 true,否则 false。"
        '只输出 JSON {"is_correct": true|false}。'
    )
    user = f"题目:{question['prompt']}\n参考答案:{candidates_text}\n学生填:{user_answer}"
    client = get_client()
    model = resolve_model(ModelTier.LOW)
    resp = await client.chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    )
    text = (resp.choices[0].message.content or "").strip()
    data = _safe_load_json(text)
    return bool(data.get("is_correct"))


async def _llm_judge_short(
    *, question: dict, user_answer: str
) -> tuple[float, bool, str]:
    """简答题 LLM 评分,返回 (score, is_correct, feedback)。"""
    answer = question["answer"] or {}
    rubric = answer.get("rubric") if isinstance(answer, dict) else str(answer)
    reference = answer.get("reference") if isinstance(answer, dict) else ""

    sys = _SHORT_JUDGE_SYSTEM.format(
        prompt=question["prompt"],
        rubric=rubric or "(无)",
        reference=reference or "(无)",
        user_answer=user_answer or "(空)",
    )
    client = get_client()
    model = resolve_model(ModelTier.MEDIUM)
    resp = await client.chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[{"role": "system", "content": sys}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
    )
    text = (resp.choices[0].message.content or "").strip()
    try:
        data = _safe_load_json(text)
    except Exception:
        return 0.0, False, "评分失败,请重试"
    score = float(data.get("score") or 0)
    score = max(0.0, min(10.0, score))
    is_correct = bool(data.get("is_correct")) if "is_correct" in data else score >= 6
    feedback = str(data.get("feedback") or "").strip()[:600]
    return score, is_correct, feedback


# =============================================================================
# Step 4: 提示
# =============================================================================


async def get_hint(
    *,
    owner_id: str,
    question_id: str,
    hint_level: int,
) -> dict:
    question = repos.get_practice_question(question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")
    session = repos.get_practice_session(question["session_id"], owner_id)
    if not session:
        raise HTTPException(status_code=403, detail="无权访问")

    # 优先用出题时已经生成好的 hints (避免每次都 LLM 调用)
    cached_hints: list[str] = question.get("hints") or []
    if hint_level <= len(cached_hints):
        return {"hint": cached_hints[hint_level - 1], "hint_level": hint_level}

    # 否则现场 LLM 生成
    sys = _HINT_SYSTEM.format(
        prompt=question["prompt"],
        user_answer="(还没填)",
        prior_hint_count=hint_level - 1,
        hint_level=hint_level,
    )
    client = get_client()
    model = resolve_model(ModelTier(session["model_tier"]))
    resp = await client.chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[{"role": "system", "content": sys}],
            temperature=0.4,
        )
    )
    hint_text = (resp.choices[0].message.content or "").strip()
    return {"hint": hint_text[:400], "hint_level": hint_level}


# =============================================================================
# Step 5: 结束 + 生成总结
# =============================================================================


async def finish_session(*, owner_id: str, session_id: str) -> dict:
    session = repos.get_practice_session(session_id, owner_id)
    if not session:
        raise HTTPException(status_code=404, detail="练习不存在")

    questions = repos.list_practice_questions(session_id)
    attempts_by_qid = _attempts_index(questions)

    answered = sum(1 for q in questions if q["id"] in attempts_by_qid and not attempts_by_qid[q["id"]].get("skipped"))
    correct = sum(
        1 for q in questions if (attempts_by_qid.get(q["id"]) or {}).get("is_correct") is True
    )
    accuracy = int((correct / answered) * 100) if answered else 0

    # 按知识点统计
    kp_stats: dict[str, dict[str, int]] = {}
    for q in questions:
        att = attempts_by_qid.get(q["id"]) or {}
        if att.get("skipped"):
            continue
        if att.get("is_correct") is None:
            continue
        for kp in q.get("knowledge_points") or []:
            entry = kp_stats.setdefault(kp, {"correct": 0, "wrong": 0})
            if att["is_correct"]:
                entry["correct"] += 1
            else:
                entry["wrong"] += 1

    # 生成 markdown 总结 (LLM)
    summary_md = ""
    try:
        summary_md = await _generate_summary_markdown(
            session=session,
            questions=questions,
            attempts_by_qid=attempts_by_qid,
            answered=answered,
            correct=correct,
            accuracy=accuracy,
        )
    except Exception as exc:
        logger.warning("summary generation failed: %s", exc)
        summary_md = f"# 练习已完成\n\n- 答题:{answered} / {len(questions)}\n- 正确:{correct}\n- 正确率:{accuracy}%"

    stats = {
        "answered": answered,
        "correct": correct,
        "wrong": answered - correct,
        "accuracy": accuracy,
        "total_questions": len(questions),
        "kp_stats": kp_stats,
    }

    # 落 session.summary + 状态 finished + finished_at
    from datetime import datetime, timezone

    fields = {
        "status": "finished",
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            **(session.get("summary") or {}),
            **stats,
            "markdown": summary_md,
        },
    }
    updated = repos.update_practice_session(session_id, owner_id, fields)
    return {
        "session": updated or {**session, **fields},
        "summary_markdown": summary_md,
        "stats": stats,
    }


async def _generate_summary_markdown(
    *,
    session: dict,
    questions: list[dict],
    attempts_by_qid: dict,
    answered: int,
    correct: int,
    accuracy: int,
) -> str:
    try:
        agent = resolve_agent(session["agent_key"], owner_id=session["owner_id"])
        agent_name = agent.display_name
    except Exception:
        agent_name = session["agent_key"]

    rows = []
    for q in questions:
        att = attempts_by_qid.get(q["id"]) or {}
        if att.get("skipped"):
            verdict = "跳过"
        elif att.get("is_correct") is True:
            verdict = "✓"
        elif att.get("is_correct") is False:
            verdict = "✗"
        elif att.get("score") is not None:
            verdict = f"评分 {att['score']}/10"
        else:
            verdict = "未答"
        kp = ",".join(q.get("knowledge_points") or []) or "-"
        rows.append(
            f"{q['idx']}. [{q['kind']} D{q['difficulty']} | {kp}] {verdict}"
        )

    sys = _SUMMARY_SYSTEM.format(
        topic=session["topic"],
        agent_name=agent_name,
        answered=answered,
        correct=correct,
        accuracy=accuracy,
        rows_block="\n".join(rows) if rows else "(无)",
    )
    client = get_client()
    model = resolve_model(ModelTier(session["model_tier"]))
    resp = await client.chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[{"role": "system", "content": sys}],
            temperature=0.3,
        )
    )
    return (resp.choices[0].message.content or "").strip()


# =============================================================================
# 视图组装
# =============================================================================


def session_view(session: dict) -> dict:
    """给前端 list / get 用的 session 视图,附加统计字段。"""
    questions = repos.list_practice_questions(session["id"])
    attempts_by_qid = _attempts_index(questions)
    answered = sum(
        1
        for q in questions
        if q["id"] in attempts_by_qid and not attempts_by_qid[q["id"]].get("skipped")
    )
    correct = sum(
        1
        for q in questions
        if (attempts_by_qid.get(q["id"]) or {}).get("is_correct") is True
    )
    return {
        **session,
        "question_count": len(questions),
        "answered_count": answered,
        "correct_count": correct,
    }


def session_questions_view(owner_id: str, session_id: str) -> list[dict]:
    """给前端 chat 模式 / 复盘 用 — 含 attempt + 答案 reveal (session finished 后才暴露)。"""
    session = repos.get_practice_session(session_id, owner_id)
    if not session:
        raise HTTPException(status_code=404, detail="练习不存在")
    questions = repos.list_practice_questions(session_id)
    attempts_by_qid = _attempts_index(questions)
    out: list[dict] = []
    for q in questions:
        att = attempts_by_qid.get(q["id"])
        view = _question_for_client(q)
        # 学生已经作答的题:吐 explanation + correct_answer + 附 attempt
        if att:
            view["explanation"] = q.get("explanation")
            view["attempt"] = att
            view["correct_answer"] = q["answer"]
        out.append(view)
    return out
