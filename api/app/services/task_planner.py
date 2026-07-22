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
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ..agents.registry import all_builtin_agents
from ..core.llm import ModelTier, build_chat_kwargs, get_client, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

MAX_TASKS = 3
MIN_TASKS = 2  # 至少生成 2 条才算成功
ALLOWED_TAGS = {"薄弱", "复习", "新学", "规划"}
# 学科 → 兜底 label (仅在 agent 元数据缺失 subject_name 时用)
SUBJECT_LABEL_BY_ID = {
    "math": "数学",
    "english": "英语",
    "chinese": "语文",
}
# 近 N 天的会话认为是"最近在学",用于计算老师池排序 + 冷却
RECENT_WINDOW_DAYS = 14
# 老师超过 N 天没互动,不主动推荐 (除非池子里只有它)
STALE_AGENT_DAYS = 30


SYSTEM_PROMPT = """你是「学习驾驶舱」的 AI 学习教练,为学生设计「今日 3 件事」。
学生打开 App 就能看到这 3 条,点一下就进入对应老师开始学 —— 你要让他不用自己想"今天该做什么"。

# 核心排序原则 (从高到低)
1. **学生的学习目标 (learning_goal) 是主线** —— 每条任务都应可解释为"这一步在朝目标推进"。
2. **优先延续最近在跟的老师** —— 学生最近哪个老师用得多、上次聊到哪儿,就顺着往下推。
   突然塞一个 30 天没互动的老师 (数据里会标注 [长期未用]) 是**打断学习节奏**,除非老师池里只剩它。
3. **不强制学科多样性**:如果学生的目标本来就聚焦在一个方向 (如"准备量化面试"),
   3 条都是同一位老师 / 同一主线也 OK。**贴近目标 > 表面上"看起来均衡"**。

# 硬约束
- **agent_type 只能从下方"可推荐老师池"里选**,不允许出现池外的 key。
- 池里标 [长期未用] 的老师默认**不用**,除非它是唯一选项。
- **规划任务 (tag="规划" 由 head_teacher 承接) 改成条件推荐,不再强制**:
  - 当学生学习目标模糊 / 无进展 / 长期停滞 / 需要复盘 / 计划到期时才加 1 条;
  - 否则**优先把 3 个名额都给学科/专业推进,不要凑数**。

# 任务本身的质量要求
- 数量恰好 3 条 (若老师池只允许更少多样性,重复同一位老师也可,但内容不能重复)。
- **极致具体,不要空话**:
  - ❌ "复习数学" / "继续学面试"
  - ✅ "用配方法订正 3 道二次函数顶点题" / "手推一次 Adam 优化器的偏差修正公式"
- **starter_prompt** = 学生点开任务后 AI 老师收到的第一句话,**用学生第一人称口语化**,
  要让老师立刻知道要讲什么 / 出什么题 / 复盘什么;引用具体知识点或场景。
- **estimated_minutes** 5-30 之间,符合真实工作量。
- **tag 严格四选一**:薄弱 / 复习 / 新学 / 规划。
- **subject_label / subject_id** 从老师池对应老师的元数据里取:
  - 平台 K12 老师 (数学/英语/语文) 用其固定学科;
  - 自定义老师若无 subject_id,`subject_id=null`,`subject_label` 直接用**该老师的 display_name**
    (例如老师叫"量化MLE导师",subject_label 就写"量化MLE导师")。
- 若提供了 knowledge_point_ids 候选,可关联 1 个到任务里 (只用池里给的 id,别编造)。

输出必须是合法 JSON:
{
  "tasks": [
    {
      "title": "<≤16 字>",
      "description": "<≤80 字>",
      "subject_label": "<平台学科名 或 自定义老师 display_name>",
      "subject_id": "<math | english | chinese | null>",
      "agent_type": "<必须是老师池里的 agent_key>",
      "estimated_minutes": 5..30,
      "tag": "薄弱 | 复习 | 新学 | 规划",
      "starter_prompt": "<≤80 字,学生第一人称>",
      "knowledge_point_ids": ["..."]
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
- **学习目标 (主线)**: {learning_goal}

【可推荐老师池 (按近 14 天互动次数降序,只能从这里选 agent_type)】
{agent_pool_block}

【最近对话主线 (体现学生正在深挖什么;优先延续,不要打断)】
{recent_sessions_block}

【各学科 K12 进度 (仅当老师池含 K12 老师时相关;非 K12 目标可忽略)】
{progress_block}

【可关联的薄弱知识点候选 (id: 名称, mastery)】
{weak_kp_block}

请严格按系统提示输出 JSON。特别注意:
- 3 条任务都要能说清"这一步怎么帮学习目标『{learning_goal_short}』往前推 1 步"。
- agent_type **只能**从上面老师池选,**不要**用池外的 key。
- 如果学生最近 30 天没和某位老师互动 (标 [长期未用]),**不要**主动推荐它。"""


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


def _format_recent_sessions(
    sessions: list[dict], agent_name_by_key: dict[str, str] | None = None
) -> str:
    if not sessions:
        return "(无,这是学生第一次使用)"
    lines = []
    for s in sessions[:8]:
        title = (s.get("title") or "(无标题)").strip()[:40]
        akey = s.get("agent_type", "?")
        aname = (agent_name_by_key or {}).get(akey, akey)
        updated = (s.get("updated_at") or s.get("created_at") or "")[:10]
        lines.append(f"- [{updated}] {aname} ({akey}): {title}")
    return "\n".join(lines)


def _format_agent_pool(agent_pool: list[dict]) -> str:
    """按最近互动降序输出老师池;标注 [长期未用] 供 LLM 决策。"""
    if not agent_pool:
        return "(空,没有可用老师)"
    lines = []
    for a in agent_pool:
        count = a["recent_session_count"]
        last = a.get("last_used_date") or "从未"
        stale_tag = " [长期未用]" if a.get("is_stale") else ""
        owner = "自定义" if a["owner_type"] == "user" else "平台"
        tagline = a.get("tagline") or a.get("role") or ""
        subj = f", subject_id={a.get('subject_id')}" if a.get("subject_id") else ""
        lines.append(
            f"- agent_key={a['agent_key']} | {a['display_name']} ({owner}{subj}) "
            f"| 近14天{count}次 · 上次{last}{stale_tag}\n    简介: {tagline[:60]}"
        )
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


def _validate_task(
    item: dict,
    valid_kp_ids: set[str],
    agent_meta_by_key: dict[str, dict],
) -> dict | None:
    """校验单条任务,不合法返回 None。

    Phase 6.x: agent_type 白名单从 dynamic 老师池取 (含用户自定义);
    subject_id / subject_label 也从老师元数据推,不再 K12 硬编码。
    """
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
        if agent_type not in agent_meta_by_key:
            return None
        if tag not in ALLOWED_TAGS:
            return None

        # 学科 & label 一致性:从老师池元数据推
        meta = agent_meta_by_key[agent_type]
        canonical_subject_id = meta.get("subject_id")
        if agent_type == "head_teacher":
            subject_id = None
            subject_label = subject_label or "学习规划"
        elif canonical_subject_id:
            subject_id = canonical_subject_id
            # K12 学科用固定 label,其它情况允许 LLM 提供的 label 或 fallback display_name
            subject_label = (
                SUBJECT_LABEL_BY_ID.get(canonical_subject_id)
                or subject_label
                or meta.get("display_name")
                or ""
            )
        else:
            # 自定义老师:subject_id 强制 null,label 用 display_name 兜底
            subject_id = None
            subject_label = subject_label or meta.get("display_name") or "专项"

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
            "subject_label": subject_label[:20],
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
        **build_chat_kwargs(
            model=model,
            response_format={"type": "json_object"},
            temperature=0.7,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        ),
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return {"data": json.loads(content), "model": model}
    except json.JSONDecodeError as exc:
        logger.warning("planner 返回非 JSON: %s | %s", exc, content[:200])
        return {"data": {}, "model": model}


def _build_agent_pool(student_id: str, recent_sessions: list[dict]) -> list[dict]:
    """构建"可推荐老师池"= 平台 4 个 + 用户自定义,附带最近使用统计。

    排序:近 14 天 session_count 降序 → 上次使用日期降序 → display_name。
    对于 30 天没用过的老师,打 is_stale=True 让 LLM 默认不推。
    """
    now = datetime.now(timezone.utc)
    recent_cutoff = (now - timedelta(days=RECENT_WINDOW_DAYS)).date().isoformat()
    stale_cutoff = (now - timedelta(days=STALE_AGENT_DAYS)).date().isoformat()

    counts: Counter = Counter()
    last_used: dict[str, str] = {}
    for s in recent_sessions:
        akey = s.get("agent_type")
        if not akey:
            continue
        upd = (s.get("updated_at") or s.get("created_at") or "")[:10]
        if upd and upd >= recent_cutoff:
            counts[akey] += 1
        if upd and (akey not in last_used or upd > last_used[akey]):
            last_used[akey] = upd

    # 拉可见老师列表 (平台 + 该 owner 私有);DB 挂了就退化用 hardcoded builtin
    try:
        rows = repos.list_user_agents(owner_id=student_id)
    except Exception as exc:  # pragma: no cover
        logger.warning("list_user_agents 失败,退化到 hardcoded builtin: %s", exc)
        rows = []

    pool: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        akey = r.get("agent_key")
        if not akey or akey in seen:
            continue
        seen.add(akey)
        last_dt = last_used.get(akey)
        pool.append(
            {
                "agent_key": akey,
                "display_name": r.get("display_name") or akey,
                "tagline": r.get("tagline") or "",
                "role": r.get("role") or "",
                "subject_id": r.get("subject_id"),
                "owner_type": r.get("owner_type") or "platform",
                "recent_session_count": counts.get(akey, 0),
                "last_used_date": last_dt,
                "is_stale": bool(last_dt) and last_dt < stale_cutoff,
            }
        )

    # DB 拿不到时,用 hardcoded 4 个内置老师兜底
    if not pool:
        for a in all_builtin_agents():
            last_dt = last_used.get(a.agent_type)
            pool.append(
                {
                    "agent_key": a.agent_type,
                    "display_name": a.display_name,
                    "tagline": a.tagline,
                    "role": a.role,
                    "subject_id": a.subject_id,
                    "owner_type": "platform",
                    "recent_session_count": counts.get(a.agent_type, 0),
                    "last_used_date": last_dt,
                    "is_stale": bool(last_dt) and last_dt < stale_cutoff,
                }
            )

    # 排序:最近用得多 > 上次日期近 > 名字
    pool.sort(
        key=lambda a: (
            -a["recent_session_count"],
            -(int(a["last_used_date"].replace("-", "")) if a["last_used_date"] else 0),
            a["display_name"],
        )
    )
    return pool


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
    # ↑ limit 从 8 提到 20 让老师使用频率统计更准
    recent_sessions = repos.list_sessions(student_id, limit=20)
    agent_pool = _build_agent_pool(student_id, recent_sessions)
    return {
        "profile": profile,
        "progress": progress,
        "recent_sessions": recent_sessions,
        "agent_pool": agent_pool,
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
    agent_pool = ctx["agent_pool"]

    # 判断是否新用户:所有学科 covered_count 都是 0 且从没聊过
    is_new_user = (
        all((p.get("covered_count") or 0) == 0 for p in progress)
        and not recent_sessions
    )
    if is_new_user:
        logger.info("学生 %s 为全新用户,使用默认任务", student_id)
        return {
            "tasks": _default_tasks(),
            "context": {"reason": "new_user"},
            "model": None,
        }

    weak_kps = _collect_weak_kps(progress)
    valid_kp_ids = {w["knowledge_point_id"] for w in weak_kps if w.get("knowledge_point_id")}

    # 老师池 → dict for O(1) 查找 + prompt 展示
    agent_meta_by_key = {a["agent_key"]: a for a in agent_pool}
    agent_name_by_key = {k: v["display_name"] for k, v in agent_meta_by_key.items()}

    learning_goal = (profile.get("learning_goal") or "").strip() or "未填"
    weekday = WEEKDAYS_CN[today.weekday()]
    user_prompt = USER_PROMPT_TEMPLATE.format(
        today=today.isoformat(),
        weekday=weekday,
        name=profile.get("name") or "同学",
        grade=profile.get("grade") or "未填",
        target_exam=profile.get("target_exam") or "未填",
        focus_subjects=", ".join(profile.get("focus_subjects") or []) or "未填",
        learning_goal=learning_goal,
        learning_goal_short=learning_goal[:40],
        agent_pool_block=_format_agent_pool(agent_pool),
        recent_sessions_block=_format_recent_sessions(
            recent_sessions, agent_name_by_key
        ),
        progress_block=_format_progress(progress),
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
        t = _validate_task(item, valid_kp_ids, agent_meta_by_key)
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

    # 注意:不再强制"至少 1 条 head_teacher"。如果学生目标聚焦、正在深挖一位老师,
    # 3 条都围绕主线是合理的;规划任务由 SYSTEM_PROMPT 里的条件规则决定。

    return {
        "tasks": valid_tasks[:MAX_TASKS],
        "context": {
            "is_new_user": is_new_user,
            "weak_kp_count": len(weak_kps),
            "subjects_with_progress": [
                p["subject_id"] for p in progress if (p.get("covered_count") or 0) > 0
            ],
            "agent_pool_size": len(agent_pool),
            "recent_agent_keys": [
                a["agent_key"] for a in agent_pool if a["recent_session_count"] > 0
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
