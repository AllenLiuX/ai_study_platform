"""Phase 3: 今日推荐任务生成。

根据学生当前的:
- 画像 (年级 / 目标考试 / 关注学科)
- 进度 (各学科 avg_mastery / weak_points / current_chapter)
- 最近 7 天对话痕迹

让 LLM 生成 3 条高质量、不重复的「今日任务」,引导学生进入学习流。

任务结构 (jsonb 落库 + 出参均沿用):
{
  "id": "<uuid>",
  "title": "<≤16 字>",
  "description": "<≤80 字>",
  "subject_label": "数学 | 英语 | 语文 | 学习规划",
  "subject_id": "math | english | chinese | null",
  "agent_type": "head_teacher | math_teacher | english_teacher | chinese_teacher",
  "estimated_minutes": 5 | 10 | 15 | 20 | 30,
  "tag": "薄弱 | 复习 | 新学 | 规划",
  "starter_prompt": "<≤80 字,学生第一人称口语>",
  "knowledge_point_ids": ["..."]   // 可选
}
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import date
from typing import Any

from ..agents.registry import all_agents
from ..core.llm import ModelTier, get_client, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

MAX_TASKS = 3
MIN_TASKS = 2  # 至少生成 2 条才算成功
ALLOWED_AGENT_TYPES = {a.agent_type for a in all_agents()}
ALLOWED_TAGS = {"薄弱", "复习", "新学", "规划"}
SUBJECT_LABEL_BY_ID = {
    "math": "数学",
    "english": "英语",
    "chinese": "语文",
}
AGENT_BY_SUBJECT = {
    "math": "math_teacher",
    "english": "english_teacher",
    "chinese": "chinese_teacher",
}


SYSTEM_PROMPT = """你是「学习驾驶舱」的 AI 班主任,专门为初/高中学生设计「今日 3 件事」。
学生每天打开 App 时看到的就是你给的 3 条任务清单 —— 必须让他点开就能开始学,不要再自己想"今天该做什么"。

设计原则:
1. **数量恰好 3 条**,按推荐优先级降序。
2. **多样性**:必须覆盖以上 2 个学科或主题,不能 3 条都是同一学科;
   - 若学生有薄弱学科,**第 1 条必须是该学科的「薄弱知识点精准训练」**;
   - 至少 1 条 tag="规划",由「AI 班主任」(agent_type=head_teacher) 承接,用于反思/调整;
   - 其余 1 条可以是「新学」或「复习」(已学到一定章节后做巩固)。
3. **极致具体,不要空话**:
   - 错误示例:"复习数学" / "学英语"
   - 正确示例:"用配方法订正 3 道二次函数顶点题" / "把 unit 5 的 8 个动词不规则过去式过一遍"
4. **starter_prompt**:就是学生点开任务后,AI 老师收到的第一句话,**用学生第一人称、口语化**,
   要让老师立刻知道"要讲什么 / 出什么题 / 复盘什么";最好引用一个具体知识点或场景。
5. **estimated_minutes** 控制在 5-30 之间,符合任务真实工作量。
6. **tag 严格四选一**:薄弱 / 复习 / 新学 / 规划。
7. **agent_type 严格四选一**:head_teacher / math_teacher / english_teacher / chinese_teacher,
   且必须和 subject_label / subject_id 一致 (head_teacher 对应 subject_label="学习规划"、subject_id=null)。
8. 若提供了 knowledge_point_ids 候选,优先在任务里关联 1 个 (写到 knowledge_point_ids 数组),
   不要编造不存在的 id。

输出必须是合法 JSON,结构:
{
  "tasks": [
    {
      "title": "<≤16 字>",
      "description": "<≤80 字>",
      "subject_label": "数学 | 英语 | 语文 | 学习规划",
      "subject_id": "math | english | chinese | null",
      "agent_type": "head_teacher | math_teacher | english_teacher | chinese_teacher",
      "estimated_minutes": 5..30,
      "tag": "薄弱 | 复习 | 新学 | 规划",
      "starter_prompt": "<≤80 字,学生第一人称>",
      "knowledge_point_ids": ["..."]   // 可空数组
    }
  ]
}
"""


USER_PROMPT_TEMPLATE = """今天是 {today} ({weekday}),请为该学生生成今日 3 件事。

【学生画像】
- 姓名: {name}
- 年级: {grade}
- 目标考试: {target_exam}
- 关注学科: {focus_subjects}
- 学习目标: {learning_goal}

【各学科最新进度】
{progress_block}

【最近 7 天的对话痕迹 (避免重复推荐)】
{recent_sessions_block}

【可关联的薄弱知识点候选 (id: 名称, mastery)】
{weak_kp_block}

请严格按系统提示输出 JSON。"""


WEEKDAYS_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _format_progress(progress: list[dict]) -> str:
    if not progress:
        return "(学生还没有任何学科进度记录,属于全新用户)"
    lines = []
    for p in progress:
        weak_names = [w.get("name", "?") for w in (p.get("weak_points") or [])[:2]]
        chapter = p.get("current_chapter") or "—"
        lines.append(
            f"- {p['subject_name']}: 平均掌握 {p['avg_mastery']:.0f}/100, "
            f"已涉及 {p['covered_count']} 个知识点, 薄弱 {p['weak_count']} 个 "
            f"(近期: {', '.join(weak_names) if weak_names else '无'} | 章节: {chapter})"
        )
    return "\n".join(lines)


def _format_recent_sessions(sessions: list[dict]) -> str:
    if not sessions:
        return "(无,这是学生第一次使用)"
    lines = []
    for s in sessions[:5]:
        title = (s.get("title") or "(无标题)").strip()[:30]
        agent = s.get("agent_type", "?")
        updated = (s.get("updated_at") or "")[:10]
        lines.append(f"- [{updated}] {agent}: {title}")
    return "\n".join(lines)


def _format_weak_kps(weak_kps: list[dict]) -> str:
    if not weak_kps:
        return "(暂无)"
    lines = []
    for w in weak_kps[:15]:
        lines.append(
            f"- {w.get('knowledge_point_id') or w.get('id')}: "
            f"{w.get('name', '?')} (mastery={w.get('mastery', '?')})"
        )
    return "\n".join(lines)


def _collect_weak_kps(progress: list[dict]) -> list[dict]:
    """把各学科的 weak_points 平铺,按 mastery 升序。"""
    flat: list[dict] = []
    for p in progress:
        for w in p.get("weak_points") or []:
            flat.append(
                {
                    "knowledge_point_id": w.get("knowledge_point_id"),
                    "name": w.get("name"),
                    "mastery": w.get("mastery", 50),
                    "subject_id": p["subject_id"],
                }
            )
    flat.sort(key=lambda x: x["mastery"])
    return flat


def _default_tasks() -> list[dict]:
    """没有任何学科 progress 时的兜底任务 (新用户)。"""
    return [
        {
            "id": str(uuid.uuid4()),
            "title": "和班主任认识一下",
            "description": "告诉 AI 班主任你的年级、目标考试、最想提升哪一科,后续推荐会更准。",
            "subject_label": "学习规划",
            "subject_id": None,
            "agent_type": "head_teacher",
            "estimated_minutes": 5,
            "tag": "规划",
            "starter_prompt": "我刚来,先和你介绍下自己:我现在是X年级,最近最想搞定的是XXX,你帮我看看怎么开始。",
            "knowledge_point_ids": [],
        },
        {
            "id": str(uuid.uuid4()),
            "title": "找数学老师讲一个最近的难点",
            "description": "把最近一次让你卡壳的数学题或知识点丢给数学老师,先把一个洞补上。",
            "subject_label": "数学",
            "subject_id": "math",
            "agent_type": "math_teacher",
            "estimated_minutes": 15,
            "tag": "新学",
            "starter_prompt": "老师好,我最近遇到一个数学题/知识点搞不太清,我先描述一下场景,你帮我讲讲思路。",
            "knowledge_point_ids": [],
        },
        {
            "id": str(uuid.uuid4()),
            "title": "上传一份最近的资料",
            "description": "把最近的笔记、错题本或一篇阅读上传到资料库,后面提问就能直接引用。",
            "subject_label": "学习规划",
            "subject_id": None,
            "agent_type": "head_teacher",
            "estimated_minutes": 5,
            "tag": "规划",
            "starter_prompt": "我等会儿会上传一份资料,你提醒我把它和当前学的章节关联起来。",
            "knowledge_point_ids": [],
        },
    ]


def _validate_task(item: dict, valid_kp_ids: set[str]) -> dict | None:
    """校验单条任务,不合法返回 None。"""
    try:
        title = (item.get("title") or "").strip()
        description = (item.get("description") or "").strip()
        subject_label = (item.get("subject_label") or "").strip()
        subject_id = item.get("subject_id")
        if subject_id in ("", "null"):
            subject_id = None
        agent_type = (item.get("agent_type") or "").strip()
        tag = (item.get("tag") or "").strip()
        minutes = item.get("estimated_minutes", 15)
        starter_prompt = (item.get("starter_prompt") or "").strip()
        kp_ids = item.get("knowledge_point_ids") or []

        if not title or not description or not starter_prompt:
            return None
        if agent_type not in ALLOWED_AGENT_TYPES:
            return None
        if tag not in ALLOWED_TAGS:
            return None

        # 学科一致性
        if agent_type == "head_teacher":
            subject_id = None
            subject_label = "学习规划"
        elif agent_type in AGENT_BY_SUBJECT.values():
            inferred = next(
                (sid for sid, agent in AGENT_BY_SUBJECT.items() if agent == agent_type),
                None,
            )
            if subject_id != inferred:
                subject_id = inferred
            subject_label = SUBJECT_LABEL_BY_ID.get(subject_id or "", subject_label)

        try:
            minutes_int = int(minutes)
        except (TypeError, ValueError):
            minutes_int = 15
        minutes_int = max(5, min(60, minutes_int))

        # KP 过滤
        clean_kps: list[str] = []
        if isinstance(kp_ids, list):
            for kp in kp_ids[:5]:
                if isinstance(kp, str) and kp in valid_kp_ids:
                    clean_kps.append(kp)

        return {
            "id": str(uuid.uuid4()),
            "title": title[:24],
            "description": description[:160],
            "subject_label": subject_label,
            "subject_id": subject_id,
            "agent_type": agent_type,
            "estimated_minutes": minutes_int,
            "tag": tag,
            "starter_prompt": starter_prompt[:200],
            "knowledge_point_ids": clean_kps,
        }
    except Exception as exc:
        logger.debug("validate task 失败: %s", exc)
        return None


async def _call_llm(*, system_prompt: str, user_prompt: str) -> dict:
    client = get_client()
    # 今日任务规划每天每人最多 1 次 LLM 调用,用 MEDIUM 保证质量
    model = resolve_model(ModelTier.MEDIUM)
    resp = await client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        temperature=0.7,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return {"data": json.loads(content), "model": model}
    except json.JSONDecodeError as exc:
        logger.warning("planner 返回非 JSON: %s | %s", exc, content[:200])
        return {"data": {}, "model": model}


def _build_context(student_id: str) -> dict[str, Any]:
    profile = repos.get_profile(student_id) or {}
    subjects = repos.list_subjects()
    # 计算各学科 progress (复用 students 路由的逻辑会导致循环 import,这里 inline)
    summary_rows = {row["subject_id"]: row for row in repos.summarize_progress(student_id)}
    progress: list[dict] = []
    for s in subjects:
        sid = s["id"]
        summary = summary_rows.get(sid, {})
        weak = repos.list_weak_points(student_id, sid, limit=3)
        chapter = repos.get_recent_chapter(student_id, sid)
        progress.append(
            {
                "subject_id": sid,
                "subject_name": s["name"],
                "avg_mastery": float(summary.get("avg_mastery") or 50.0),
                "covered_count": int(summary.get("covered_count") or 0),
                "weak_count": int(summary.get("weak_count") or 0),
                "current_chapter": (chapter or {}).get("chapter_name"),
                "weak_points": weak,
            }
        )
    recent_sessions = repos.list_sessions(student_id, limit=8)
    return {
        "profile": profile,
        "progress": progress,
        "recent_sessions": recent_sessions,
    }


async def generate_tasks(student_id: str, *, today: date | None = None) -> dict:
    """生成今日任务。失败/无信号时返回兜底任务集。

    返回 {"tasks": [...], "context": {...}, "model": "..."}.
    """
    today = today or date.today()
    ctx = _build_context(student_id)
    progress = ctx["progress"]
    profile = ctx["profile"]
    recent_sessions = ctx["recent_sessions"]

    # 判断是否新用户:所有学科 covered_count 都是 0
    is_new_user = all((p.get("covered_count") or 0) == 0 for p in progress)
    if is_new_user and not recent_sessions:
        logger.info("学生 %s 为全新用户,使用默认任务", student_id)
        return {
            "tasks": _default_tasks(),
            "context": {"reason": "new_user"},
            "model": None,
        }

    weak_kps = _collect_weak_kps(progress)
    valid_kp_ids = {w["knowledge_point_id"] for w in weak_kps if w.get("knowledge_point_id")}

    weekday = WEEKDAYS_CN[today.weekday()]
    user_prompt = USER_PROMPT_TEMPLATE.format(
        today=today.isoformat(),
        weekday=weekday,
        name=profile.get("name") or "同学",
        grade=profile.get("grade") or "未填",
        target_exam=profile.get("target_exam") or "未填",
        focus_subjects=", ".join(profile.get("focus_subjects") or []) or "未填",
        learning_goal=profile.get("learning_goal") or "未填",
        progress_block=_format_progress(progress),
        recent_sessions_block=_format_recent_sessions(recent_sessions),
        weak_kp_block=_format_weak_kps(weak_kps),
    )

    try:
        llm_out = await _call_llm(system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt)
    except Exception as exc:
        logger.warning("planner LLM 调用失败: %s", exc)
        return {
            "tasks": _default_tasks(),
            "context": {"reason": "llm_failed", "error": str(exc)[:200]},
            "model": None,
        }

    raw_items = (llm_out.get("data") or {}).get("tasks") or []
    valid_tasks: list[dict] = []
    seen_titles: set[str] = set()
    for item in raw_items[:MAX_TASKS]:
        t = _validate_task(item, valid_kp_ids)
        if not t:
            continue
        if t["title"] in seen_titles:
            continue
        seen_titles.add(t["title"])
        valid_tasks.append(t)

    if len(valid_tasks) < MIN_TASKS:
        logger.warning(
            "planner 输出有效任务不足 (%d < %d),使用默认", len(valid_tasks), MIN_TASKS
        )
        return {
            "tasks": _default_tasks(),
            "context": {"reason": "too_few_valid", "raw": raw_items},
            "model": llm_out.get("model"),
        }

    # 后处理:确保至少有 1 条 head_teacher (规划) 任务
    if not any(t["agent_type"] == "head_teacher" for t in valid_tasks):
        # 把最后一条改成班主任规划
        last = valid_tasks[-1]
        valid_tasks[-1] = {
            **last,
            "agent_type": "head_teacher",
            "subject_id": None,
            "subject_label": "学习规划",
            "tag": "规划",
        }

    return {
        "tasks": valid_tasks[:MAX_TASKS],
        "context": {
            "is_new_user": is_new_user,
            "weak_kp_count": len(weak_kps),
            "subjects_with_progress": [
                p["subject_id"] for p in progress if (p.get("covered_count") or 0) > 0
            ],
        },
        "model": llm_out.get("model"),
    }


# -----------------------------------------------------------------------------
# 缓存读取 / 写入
# -----------------------------------------------------------------------------
def _read_cached(student_id: str, day: date) -> dict | None:
    client = get_admin_client()
    resp = (
        client.table("student_daily_tasks")
        .select("*")
        .eq("student_id", student_id)
        .eq("task_date", day.isoformat())
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def _upsert_cached(
    *,
    student_id: str,
    day: date,
    tasks: list[dict],
    context: dict | None,
    model: str | None,
) -> dict:
    client = get_admin_client()
    payload = {
        "student_id": student_id,
        "task_date": day.isoformat(),
        "tasks": tasks,
        "context": context or {},
        "model": model,
    }
    resp = (
        client.table("student_daily_tasks")
        .upsert(payload, on_conflict="student_id,task_date")
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else payload


async def get_or_generate_today_tasks(
    student_id: str, *, force_refresh: bool = False
) -> dict:
    """前端入口:读缓存 / 生成。返回 {"tasks": [...], "generated_at": "...", "model": "..."}"""
    today = date.today()
    if not force_refresh:
        cached = _read_cached(student_id, today)
        if cached and cached.get("tasks"):
            return {
                "tasks": cached["tasks"],
                "generated_at": cached.get("updated_at") or cached.get("created_at"),
                "model": cached.get("model"),
                "cached": True,
            }

    generated = await generate_tasks(student_id, today=today)
    saved = _upsert_cached(
        student_id=student_id,
        day=today,
        tasks=generated["tasks"],
        context=generated.get("context"),
        model=generated.get("model"),
    )
    return {
        "tasks": saved["tasks"],
        "generated_at": saved.get("updated_at") or saved.get("created_at"),
        "model": saved.get("model"),
        "cached": False,
    }
