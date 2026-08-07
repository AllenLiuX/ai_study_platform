"""用 LLM 生成领域无关、学习线数量动态的长期学习规划。"""

from __future__ import annotations

import json
import re
from typing import Any

from ..core.llm import ModelTier, build_chat_kwargs, get_client, resolve_model
from ..schemas.roadmap import GenerateRoadmapRequest, RoadmapLane

_SYSTEM_PROMPT = """你是资深课程架构师和学习科学专家。请为用户生成可长期执行的学习科技树。

核心规则:
1. 学习线数量必须动态决定，不要机械固定为 4 条。根据领域复杂度生成 2-6 条互相独立但可协同的学习线。
2. 覆盖行业/考试的核心能力，至少一条学习线负责真实项目、考试或阶段测评，用于验证学习成果。
3. 每条线 3-7 个有递进关系的节点；节点粒度应适合 1-8 周完成，不要把整门学科塞进单一节点。
4. 根据用户基线决定起点。已掌握内容标记 done 或 review；全局只设置 1-2 个 current 节点；
   可立即开始但非当前重点的标记 open；有前置条件的标记 locked。
5. 掌握证据必须可观察，例如考试分数、无提示完成任务、真实作品、连续稳定表现，不能只写“理解”。
6. prerequisites 填节点标题；next_action 是用户今天能执行的具体动作。
7. 不编造证书规则、法律或平台政策。若领域依赖时效性规则，在 description 中提醒用户核验最新官方来源。
8. 输出中文；只输出 JSON，不要 markdown。

JSON 格式:
{
  "title": "规划标题",
  "lanes": [
    {
      "id": "英文短标识",
      "title": "学习线名称",
      "purpose": "该线解决的问题",
      "nodes": [
        {
          "id": "英文短标识",
          "title": "节点名称",
          "description": "学习范围",
          "phase": "阶段名",
          "status": "done|current|open|locked|review",
          "estimated_hours": 20,
          "prerequisites": ["前置节点标题"],
          "mastery_evidence": ["可验证证据"],
          "mastery": 0,
          "next_action": "今天可以做的动作"
        }
      ]
    }
  ]
}"""

_VALID_STATUSES = {"done", "current", "open", "locked", "review"}


def _load_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.+?)\s*```$", text, flags=re.S | re.I)
    if fence:
        text = fence.group(1)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("规划输出必须是 JSON 对象")
    return value


def _slug(raw: Any, fallback: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", str(raw or "").lower()).strip("-_")
    return value[:48] or fallback


def _clean_lanes(raw_lanes: Any) -> list[RoadmapLane]:
    if not isinstance(raw_lanes, list):
        raise ValueError("规划缺少 lanes 数组")

    lanes: list[RoadmapLane] = []
    current_count = 0
    for lane_index, raw_lane in enumerate(raw_lanes[:8]):
        if not isinstance(raw_lane, dict):
            continue
        raw_nodes = raw_lane.get("nodes")
        if not isinstance(raw_nodes, list) or not raw_nodes:
            continue

        lane_slug = _slug(raw_lane.get("id"), "track")
        lane_id = f"lane-{lane_index + 1}-{lane_slug}"[:64]
        nodes = []
        for node_index, raw_node in enumerate(raw_nodes[:10]):
            if not isinstance(raw_node, dict):
                continue
            status = str(raw_node.get("status") or "locked")
            if status not in _VALID_STATUSES:
                status = "locked"
            if status == "current":
                current_count += 1
                if current_count > 2:
                    status = "open"

            hours = raw_node.get("estimated_hours", 10)
            try:
                hours = max(1, min(1000, int(hours)))
            except (TypeError, ValueError):
                hours = 10

            mastery = raw_node.get("mastery", 0)
            try:
                mastery = max(0, min(100, int(mastery)))
            except (TypeError, ValueError):
                mastery = 0

            node_slug = _slug(raw_node.get("id"), f"node-{node_index + 1}")
            # LLM 常在不同学习线里都生成 "foundation"；前缀确保整份规划内唯一。
            node_id = f"{lane_id}-{node_index + 1}-{node_slug}"[:120]
            nodes.append(
                {
                    "id": node_id,
                    "title": str(raw_node.get("title") or f"节点 {node_index + 1}")[:120],
                    "description": str(raw_node.get("description") or "")[:1000],
                    "phase": str(raw_node.get("phase") or "")[:80],
                    "status": status,
                    "estimated_hours": hours,
                    "prerequisites": [
                        str(item)[:120]
                        for item in (raw_node.get("prerequisites") or [])[:8]
                    ],
                    "mastery_evidence": [
                        str(item)[:300]
                        for item in (raw_node.get("mastery_evidence") or [])[:8]
                    ],
                    "mastery": mastery,
                    "next_action": str(raw_node.get("next_action") or "")[:500],
                }
            )

        if nodes:
            lanes.append(
                RoadmapLane(
                    id=lane_id,
                    title=str(raw_lane.get("title") or f"学习线 {lane_index + 1}")[:100],
                    purpose=str(raw_lane.get("purpose") or "")[:500],
                    nodes=nodes,
                )
            )

    if not lanes:
        raise ValueError("模型没有生成有效学习线")

    # 模型偶尔没有设置当前节点；把第一个非完成节点设为 current，保证首页有明确下一步。
    if not any(node.status == "current" for lane in lanes for node in lane.nodes):
        first = next(
            (
                node
                for lane in lanes
                for node in lane.nodes
                if node.status not in {"done", "review"}
            ),
            lanes[0].nodes[0],
        )
        first.status = "current"
    return lanes


async def generate_roadmap(
    payload: GenerateRoadmapRequest,
    *,
    agent_context: str = "",
) -> tuple[str, list[RoadmapLane], str]:
    model = resolve_model(ModelTier.MEDIUM)
    target = payload.target_date.isoformat() if payload.target_date else "未指定"
    user_prompt = f"""学习目标：{payload.goal}
当前基础：{payload.baseline or "未说明，请从合理的基线诊断开始"}
每周可投入：{payload.weekly_hours} 小时
目标日期：{target}
偏好与约束：{payload.preferences or "无"}
跟随老师：{agent_context or "未指定，请采用通用教练风格"}

请自行判断需要几条学习线。不要为了排版凑数量，也不要遗漏成果验证线。"""

    response = await get_client().chat.completions.create(
        **build_chat_kwargs(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
            max_tokens=7000,
        )
    )
    data = _load_json(response.choices[0].message.content or "")
    title = str(data.get("title") or payload.goal)[:160]
    return title, _clean_lanes(data.get("lanes")), model
