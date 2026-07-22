"""Phase 7: 群组 / 班级 路由.

设计:
- 权限模型:owner > admin > member (member 也能上传/新建/删自己的)
- 发现方式:hybrid — 公开群走 /search, 私密群走 invite_code
- 建群自动生成 8 位 invite_code (创建者=owner, member_count=1)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..schemas.group import (
    CreateGroupRequest,
    Group,
    GroupDetail,
    GroupMember,
    JoinByCodeRequest,
    UpdateGroupRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/groups", tags=["groups"])


# -----------------------------------------------------------------------------
# 帮助函数
# -----------------------------------------------------------------------------
def _to_group(row: dict) -> Group:
    return Group(
        id=row["id"],
        name=row["name"],
        description=row.get("description"),
        invite_code=row["invite_code"],
        is_public=bool(row.get("is_public", False)),
        owner_id=row["owner_id"],
        member_count=int(row.get("member_count") or 0),
        emoji=row.get("emoji"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _require_member(group_id: str, user_id: str) -> dict:
    """确保 user 是该群成员;不是就 403。返回 group_members 行 (含 role)。"""
    membership = repos.get_group_member(group_id, user_id)
    if not membership:
        raise HTTPException(status_code=403, detail="你不是该群成员")
    return membership


def _require_role(membership: dict, roles: set[str]) -> None:
    if membership.get("role") not in roles:
        raise HTTPException(status_code=403, detail="权限不足 (需要 owner/admin)")


# -----------------------------------------------------------------------------
# 创建 / 更新 / 删除
# -----------------------------------------------------------------------------
@router.post("", response_model=Group, status_code=201)
async def create_group(
    payload: CreateGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> Group:
    """创建群组。创建者自动成为 owner,系统生成 8 位 invite_code。"""
    row = repos.create_group(
        owner_id=user.id,
        payload={
            "name": payload.name,
            "description": payload.description,
            "is_public": bool(payload.is_public),
            "emoji": payload.emoji,
        },
    )
    return _to_group(row)


@router.patch("/{group_id}", response_model=Group)
async def update_group(
    group_id: str,
    payload: UpdateGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> Group:
    group = repos.get_group_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="群不存在")
    if group["owner_id"] != user.id:
        raise HTTPException(status_code=403, detail="仅群主可修改群信息")
    fields = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not fields:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    row = repos.update_group(group_id, fields)
    if not row:
        raise HTTPException(status_code=500, detail="更新失败")
    return _to_group(row)


@router.delete("/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """删群 (仅 owner)。级联删除所有 members + 该群下的 materials/notes。"""
    group = repos.get_group_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="群不存在")
    if group["owner_id"] != user.id:
        raise HTTPException(status_code=403, detail="仅群主可删除群")
    repos.delete_group(group_id)


# -----------------------------------------------------------------------------
# 列表 / 搜索 / 详情
# -----------------------------------------------------------------------------
@router.get("/mine", response_model=list[Group])
async def list_my_groups(
    user: CurrentUser = Depends(get_current_user),
) -> list[Group]:
    """我加入的所有群 (按加入时间倒序)。"""
    rows = repos.list_my_groups(user.id)
    return [_to_group(r) for r in rows]


@router.get("/search", response_model=list[Group])
async def search_public_groups(
    q: str | None = Query(default=None, max_length=60),
    _user: CurrentUser = Depends(get_current_user),
) -> list[Group]:
    """搜公开群 (is_public=true)。q 走 ilike 模糊匹配 name/description。"""
    rows = repos.search_public_groups(q=q)
    return [_to_group(r) for r in rows]


@router.get("/{group_id}", response_model=GroupDetail)
async def get_group_detail(
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> GroupDetail:
    """群详情 — 必须是成员;返回 my_role + 前 20 个成员 + 内容计数。"""
    membership = _require_member(group_id, user.id)
    group = repos.get_group_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="群不存在")

    members = repos.list_group_members(group_id, limit=20)
    members_preview = [
        GroupMember(
            user_id=m["user_id"],
            role=m["role"],
            joined_at=m.get("joined_at"),
            display_name=m.get("display_name"),
            email=m.get("email"),
        )
        for m in members
    ]
    return GroupDetail(
        id=group["id"],
        name=group["name"],
        description=group.get("description"),
        invite_code=group["invite_code"],
        is_public=bool(group.get("is_public", False)),
        owner_id=group["owner_id"],
        member_count=int(group.get("member_count") or 0),
        emoji=group.get("emoji"),
        created_at=group.get("created_at"),
        updated_at=group.get("updated_at"),
        my_role=membership["role"],
        members_preview=members_preview,
        materials_count=repos.count_group_materials(group_id),
        notes_count=repos.count_group_notes(group_id),
    )


@router.get("/{group_id}/members", response_model=list[GroupMember])
async def list_members(
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> list[GroupMember]:
    _require_member(group_id, user.id)
    rows = repos.list_group_members(group_id, limit=200)
    return [
        GroupMember(
            user_id=r["user_id"],
            role=r["role"],
            joined_at=r.get("joined_at"),
            display_name=r.get("display_name"),
            email=r.get("email"),
        )
        for r in rows
    ]


# -----------------------------------------------------------------------------
# 加入 / 退出
# -----------------------------------------------------------------------------
@router.post("/join", response_model=Group)
async def join_by_code(
    payload: JoinByCodeRequest,
    user: CurrentUser = Depends(get_current_user),
) -> Group:
    """靠 invite_code 加群 (私密群唯一途径, 公开群也支持)。"""
    code = payload.invite_code.strip().upper()
    group = repos.get_group_by_invite_code(code)
    if not group:
        raise HTTPException(status_code=404, detail="邀请码无效")
    repos.add_group_member(group_id=group["id"], user_id=user.id, role="member")
    # 重读拿最新 member_count (trigger 已加 1)
    return _to_group(repos.get_group_by_id(group["id"]) or group)


@router.post("/{group_id}/join", response_model=Group)
async def join_public_group(
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Group:
    """直接加入某个公开群 (不需要 invite_code)。私密群会 403。"""
    group = repos.get_group_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="群不存在")
    if not group.get("is_public"):
        raise HTTPException(status_code=403, detail="该群为私密, 需邀请码加入")
    repos.add_group_member(group_id=group_id, user_id=user.id, role="member")
    return _to_group(repos.get_group_by_id(group_id) or group)


@router.post("/{group_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_group(
    group_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """退出群 (owner 不允许退, 需要先转让或删群)。"""
    group = repos.get_group_by_id(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="群不存在")
    if group["owner_id"] == user.id:
        raise HTTPException(
            status_code=400,
            detail="群主不能退群, 请先解散群 (删除) 或将群主转让给他人",
        )
    ok = repos.remove_group_member(group_id, user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="你不是该群成员")


# -----------------------------------------------------------------------------
# 成员管理 (踢人)
# -----------------------------------------------------------------------------
@router.delete(
    "/{group_id}/members/{target_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def kick_member(
    group_id: str,
    target_user_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """踢人 (仅 owner/admin, 不能踢 owner)。"""
    membership = _require_member(group_id, user.id)
    _require_role(membership, {"owner", "admin"})
    if target_user_id == user.id:
        raise HTTPException(status_code=400, detail="要踢自己请用退群接口")
    target = repos.get_group_member(group_id, target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="该成员不在群里")
    if target["role"] == "owner":
        raise HTTPException(status_code=400, detail="不能踢群主")
    repos.remove_group_member(group_id, target_user_id)
