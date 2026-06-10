"""Phase 2: 从一轮对话里抽取知识点 + 掌握度变化。

被 chat_service 在 SSE 流结束后异步触发(BackgroundTasks)。
失败不影响主流程 (打 log 即可)。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from ..core.llm import ModelTier, get_client, resolve_model
from ..db import repos
from ..db.supabase_client import get_admin_client

logger = logging.getLogger(__name__)

# mastery_delta 上下限,防止 LLM 给极端值
DELTA_CLAMP = 15
MAX_POINTS_PER_TURN = 3

SYSTEM_PROMPT = """你是一名教学进度分析师。读完一轮"学生 × AI 老师"的对话后,
你要判断这一轮里学生展示出对哪些知识点的掌握情况,以及他对这些知识点是
"提问 / 困惑 / 已掌握 / 巩固"中的哪种状态。

严格遵循:
1. 只能从【候选知识点】里选,不能编造 id
2. 一轮对话最多返回 3 个最相关的知识点;若没有任何明显涉及的知识点,返回空数组
3. mastery_delta 的取值参考:
   - status="asked":学生只是在提问,没暴露明显问题 → delta = -2
   - status="struggled":学生表达了错误理解 / 反复混淆 → delta = -10
   - status="got_it":学生表达了正确理解 / 解出题 → delta = +8
   - status="reviewed":学生主动复习已学知识点 → delta = +3
4. 输出严格 JSON,不要任何额外解释
"""

USER_PROMPT_TEMPLATE = """学科:{subject_name}

【学生的问题】
{user_msg}

【AI 老师的回答】
{assistant_msg}

【候选知识点】(必须从这里选 id)
{kp_list}

请输出 JSON,结构:
{{
  "knowledge_points": [
    {{
      "id": "<必须从候选里选>",
      "status": "asked | struggled | got_it | reviewed",
      "evidence": "<引用对话中的关键短语 ≤30 字>",
      "mastery_delta": -10..10
    }}
  ],
  "summary": "<一句话总结这轮对话学生的状态,≤40 字>"
}}
"""


def _list_leaf_kps(subject_id: str) -> list[dict]:
    """取某学科所有 leaf 知识点 (id + name)。"""
    client = get_admin_client()
    resp = (
        client.table("knowledge_points")
        .select("id, name, parent_id")
        .eq("subject_id", subject_id)
        .eq("is_leaf", True)
        .execute()
    )
    return resp.data or []


def _format_kp_list(kps: list[dict]) -> str:
    return "\n".join(f"- {k['id']}: {k['name']}" for k in kps)


async def _call_llm(*, subject_name: str, user_msg: str, assistant_msg: str, kps: list[dict]) -> dict:
    client = get_client()
    user_prompt = USER_PROMPT_TEMPLATE.format(
        subject_name=subject_name,
        user_msg=user_msg.strip()[:1500],
        assistant_msg=assistant_msg.strip()[:1500],
        kp_list=_format_kp_list(kps),
    )
    model = resolve_model(ModelTier.LOW)  # 后台抽取:用最便宜的 tier 控制开销
    resp = await client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        temperature=0.0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.warning("extractor 返回的不是合法 JSON: %s", content[:200])
        return {}


def _upsert_progress(
    *,
    student_id: str,
    kp_id: str,
    status: str,
    delta: int,
    evidence: str,
    summary: str,
    raw: dict,
) -> None:
    """累加 encounter_count + 调整 mastery。"""
    client = get_admin_client()
    existing = (
        client.table("student_progress")
        .select("*")
        .eq("student_id", student_id)
        .eq("knowledge_point_id", kp_id)
        .maybe_single()
        .execute()
    )
    row = (existing.data if existing else None) or {}

    old_mastery = int(row.get("mastery", 50))
    new_mastery = max(0, min(100, old_mastery + delta))
    encounter_count = int(row.get("encounter_count", 0)) + 1
    recent_error_count = int(row.get("recent_error_count", 0))
    if status == "struggled":
        recent_error_count += 1
    elif status == "got_it":
        # 答对了就清零最近错误数 (用衰减更合适,这里先粗暴归零)
        recent_error_count = 0

    payload = {
        "student_id": student_id,
        "knowledge_point_id": kp_id,
        "mastery": new_mastery,
        "confidence": 0.5 + min(0.4, encounter_count * 0.05),  # 接触越多越自信
        "encounter_count": encounter_count,
        "recent_error_count": recent_error_count,
        "last_encountered_at": datetime.now(timezone.utc).isoformat(),
        "last_evaluation_at": datetime.now(timezone.utc).isoformat(),
        "last_evaluation": {
            "status": status,
            "evidence": evidence,
            "delta": delta,
            "summary": summary,
            "raw": raw,
        },
    }
    client.table("student_progress").upsert(
        payload, on_conflict="student_id,knowledge_point_id"
    ).execute()


async def extract_and_update(
    *,
    student_id: str,
    subject_id: str,
    subject_name: str,
    session_id: str,
    assistant_message_id: str | None,
    user_msg: str,
    assistant_msg: str,
) -> dict:
    """主入口:LLM 抽取 → student_progress upsert → 返回抽取结果。

    返回字典:
      {
        "knowledge_points": [{"id": "...", "status": "...", "delta": int, "evidence": "..."}],
        "summary": "..."
      }
    """
    if not user_msg.strip() or not assistant_msg.strip():
        return {}

    kps = _list_leaf_kps(subject_id)
    if not kps:
        logger.info("subject %s 没有 leaf 知识点,跳过抽取", subject_id)
        return {}

    try:
        result = await _call_llm(
            subject_name=subject_name,
            user_msg=user_msg,
            assistant_msg=assistant_msg,
            kps=kps,
        )
    except Exception as exc:
        logger.warning("LLM 抽取失败 (%s): %s", session_id, exc)
        return {}

    raw_points: list[dict] = (result.get("knowledge_points") or [])[:MAX_POINTS_PER_TURN]
    valid_ids = {k["id"] for k in kps}
    summary = (result.get("summary") or "").strip()[:200]

    extracted: list[dict] = []
    for p in raw_points:
        kp_id = p.get("id")
        if kp_id not in valid_ids:
            continue
        status = p.get("status", "asked")
        if status not in ("asked", "struggled", "got_it", "reviewed"):
            status = "asked"
        delta_raw = p.get("mastery_delta", 0)
        try:
            delta = int(delta_raw)
        except (TypeError, ValueError):
            delta = 0
        delta = max(-DELTA_CLAMP, min(DELTA_CLAMP, delta))
        evidence = str(p.get("evidence", "")).strip()[:150]

        try:
            _upsert_progress(
                student_id=student_id,
                kp_id=kp_id,
                status=status,
                delta=delta,
                evidence=evidence,
                summary=summary,
                raw=p,
            )
            extracted.append(
                {"id": kp_id, "status": status, "delta": delta, "evidence": evidence}
            )
        except Exception as exc:
            logger.warning("upsert progress %s 失败: %s", kp_id, exc)

    payload = {"knowledge_points": extracted, "summary": summary}

    # 把抽取结果回写到 assistant message 的 metadata,便于前端展示和 debug
    if assistant_message_id and extracted:
        try:
            client = get_admin_client()
            current = (
                client.table("chat_messages")
                .select("metadata")
                .eq("id", assistant_message_id)
                .maybe_single()
                .execute()
            )
            md = (current.data or {}).get("metadata") or {}
            md["progress"] = payload
            client.table("chat_messages").update({"metadata": md}).eq(
                "id", assistant_message_id
            ).execute()
        except Exception as exc:
            logger.warning("写回 message metadata 失败: %s", exc)

    logger.info(
        "progress extract session=%s student=%s subject=%s extracted=%d",
        session_id,
        student_id,
        subject_id,
        len(extracted),
    )
    return payload
