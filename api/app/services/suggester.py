"""Phase 2.5: 学习流引导 — 基于刚刚的对话生成「接下来想问什么」建议。

被 chat_service 在主回答 streaming 结束后 inline 调用,把建议通过 SSE 推到前端,
让学生在看完回答时已经看到 2-3 条可以一键继续的问题。

四种类型:
  - deep_dive: 继续深入当前刚问的话题
  - explore:   横向跳到关联或推荐的新知识点
  - practice:  让老师出一道相关的题练手
  - review:    回顾历史薄弱点 (若有 student_progress 数据)
"""

from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from ..agents.registry import AgentConfig
from ..core.llm import ModelTier, get_client, resolve_model
from ..db import repos

logger = logging.getLogger(__name__)

FollowUpType = Literal["deep_dive", "explore", "practice", "review"]
MAX_SUGGESTIONS = 3
MAX_QUESTION_LEN = 28


class FollowUp(BaseModel):
    type: FollowUpType
    question: str = Field(..., max_length=60)
    knowledge_point: str | None = None
    reason: str | None = None


SYSTEM_PROMPT = """你是一名贴心的「学习引导员」。看完学生与 AI 老师的最近一轮对话后,
你要给学生 2-3 条「接下来可以问什么」的建议,帮他保持学习流、不用每次自己想下一步。

建议类型 type 必须从下面四个里选:
  - deep_dive: 继续深入刚问的话题 (比如"那如果系数变了会怎么样")
  - explore:   横向跳到关联的新知识点
  - practice:  让老师出一道相关的题让学生练手
  - review:    回顾学生已暴露的薄弱点 (只有在 student_weak_points 非空时才能用)

输出严格遵循:
1. 每条 question 必须用学生第一人称提问,口语化,简短 (≤ 25 个汉字 / 50 字符)
2. 总数 2-3 条,顺序按推荐度排序;至少包含 1 条 deep_dive
3. 不要重复学生刚问过的内容
4. 不要给出在常识之外的虚构信息 / 不要超出该学科范畴
5. 输出 JSON,不要任何解释,结构:
{
  "items": [
    { "type": "<...>", "question": "<≤25汉字>", "knowledge_point": "<可选,候选 KP id 或留空>", "reason": "<可选,一句话给系统看的解释>" }
  ]
}
"""

USER_PROMPT_TEMPLATE = """学科: {subject_name}
学生角色: 初中生
老师角色: {agent_role}

【学生最近的提问】
{user_msg}

【AI 老师的回答】
{assistant_msg}

【学生在本科已暴露的薄弱点 (可用于 review 建议)】
{weak_points_block}

【可选 knowledge_point 候选 id (建议中的 explore/review 类可填,deep_dive/practice 可省略)】
{kp_list_block}

请根据系统提示输出 2-3 条建议,JSON 格式。"""


def _format_weak_points(weak: list[dict]) -> str:
    if not weak:
        return "(暂无,学生刚开始学,不要使用 review 类建议)"
    lines = []
    for w in weak[:5]:
        lines.append(
            f"- {w.get('knowledge_point_id', '?')}: {w.get('name', '?')} (mastery={w.get('mastery', '?')})"
        )
    return "\n".join(lines)


def _format_kp_list(kps: list[dict]) -> str:
    if not kps:
        return "(无候选,explore 类可以不填 knowledge_point)"
    return "\n".join(f"- {k['id']}: {k['name']}" for k in kps[:20])


async def suggest_follow_ups(
    *,
    student_id: str,
    agent: AgentConfig,
    subject_id: str | None,
    user_msg: str,
    assistant_msg: str,
) -> list[FollowUp]:
    """生成 follow-ups。任何异常都吞掉,返回 []。"""
    if not user_msg.strip() or not assistant_msg.strip():
        return []

    # 拉学科 + 知识点候选 + 薄弱点 (仅学科老师)
    subject_name = "学习"
    kp_list: list[dict] = []
    weak_list: list[dict] = []
    if subject_id:
        subject_row = next(
            (s for s in repos.list_subjects() if s["id"] == subject_id), None
        )
        if subject_row:
            subject_name = subject_row["name"]
        try:
            from ..db.supabase_client import get_admin_client

            client = get_admin_client()
            resp = (
                client.table("knowledge_points")
                .select("id, name")
                .eq("subject_id", subject_id)
                .eq("is_leaf", True)
                .execute()
            )
            kp_list = resp.data or []
        except Exception as exc:
            logger.debug("拉取 kp 候选失败,忽略: %s", exc)

        try:
            weak_list = repos.list_weak_points(student_id, subject_id, limit=5)
            # 只用有交互痕迹的
            weak_list = [w for w in weak_list if w.get("encounter_count", 0) > 0]
        except Exception as exc:
            logger.debug("拉取薄弱点失败,忽略: %s", exc)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        subject_name=subject_name,
        agent_role=agent.display_name,
        user_msg=user_msg.strip()[:1200],
        assistant_msg=assistant_msg.strip()[:1500],
        weak_points_block=_format_weak_points(weak_list),
        kp_list_block=_format_kp_list(kp_list),
    )

    try:
        client = get_client()
        model = resolve_model(ModelTier.DEFAULT)
        resp = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            temperature=0.6,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.warning("suggester 返回非 JSON: %s", exc)
        return []
    except Exception as exc:
        logger.warning("suggester 调用失败: %s", exc)
        return []

    raw_items = data.get("items") or []
    valid_kp_ids = {k["id"] for k in kp_list}
    results: list[FollowUp] = []
    seen_questions: set[str] = set()
    for it in raw_items[:MAX_SUGGESTIONS]:
        try:
            t = it.get("type")
            q = (it.get("question") or "").strip()
            if not q or t not in ("deep_dive", "explore", "practice", "review"):
                continue
            if t == "review" and not weak_list:
                # 没有薄弱点时不允许 review,降级为 explore
                t = "explore"
            # 截短;若仍超长则丢弃
            if len(q) > MAX_QUESTION_LEN * 2:
                q = q[: MAX_QUESTION_LEN * 2]
            if q in seen_questions:
                continue
            seen_questions.add(q)
            kp_id = it.get("knowledge_point")
            if kp_id and kp_id not in valid_kp_ids:
                kp_id = None
            results.append(
                FollowUp(
                    type=t,  # type: ignore[arg-type]
                    question=q,
                    knowledge_point=kp_id,
                    reason=(it.get("reason") or "").strip()[:120] or None,
                )
            )
        except Exception as exc:
            logger.debug("跳过不合法的 suggestion: %s", exc)

    # 兜底:至少要有 1 条 deep_dive
    if results and not any(r.type == "deep_dive" for r in results):
        # 把第一条强转为 deep_dive (不改其它,反正前端只是个 icon)
        results[0] = FollowUp(
            type="deep_dive",
            question=results[0].question,
            knowledge_point=results[0].knowledge_point,
            reason=results[0].reason,
        )

    return results
