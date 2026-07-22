"""资料库 API:上传 / 列表 / 详情 / 删除。"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from ..core.auth import CurrentUser, get_current_user
from ..db import repos
from ..db.supabase_client import get_admin_client
from ..schemas.material import Material, MaterialType
from ..services import material_processor, parser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/materials", tags=["materials"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB,教科书/试卷 PDF 经常 30-40MB,留点余量
STORAGE_BUCKET = "materials"


def _extension(filename: str, mime_type: str) -> str:
    if "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        if ext.isalnum() and len(ext) <= 8:
            return ext
    guess = mimetypes.guess_extension(mime_type or "") or ""
    return guess.lstrip(".") or "bin"


@router.post("", response_model=Material)
async def upload_material(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    subject_id: str | None = Form(default=None),
    grade: str | None = Form(default=None),
    material_type: MaterialType = Form(default="note"),
    # Phase 7: 上传到某个群 (可选;为 null 时是个人资料库)
    group_id: str | None = Form(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> Material:
    """学生上传一份资料 (multipart)。

    后端会:
    1. 校验类型和大小
    2. 上传到 Supabase Storage (materials/<user>/<id>.<ext>)
    3. 写一行 learning_materials(parse_status='pending')
    4. BackgroundTasks 异步做 parse + chunk + embed
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名缺失")

    # Phase 7: 若指定 group_id, 必须是该群成员才能上传
    if group_id:
        if not repos.get_group_member(group_id, user.id):
            raise HTTPException(status_code=403, detail="你不是该群成员, 无法上传到此群")

    mime = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    detected = parser.detect_kind(mime, file.filename)
    # Phase 4.2: 老 .doc 二进制格式我们认得,但解析不了,给前端一个清楚指引
    if detected == "doc_legacy":
        raise HTTPException(
            status_code=400,
            detail="暂不支持老版 .doc 格式(Word 97-2003),请在 Word/WPS 里『另存为 .docx』后再上传",
        )
    # Phase 4.1+4.2: 在 PDF/text 之外接受 docx / 图片 — 图片走 vision_extractor 抽 markdown
    if detected not in {"pdf", "text", "docx", "image"}:
        raise HTTPException(
            status_code=400,
            detail="目前支持 PDF / DOCX / TXT / Markdown / 图片 (PNG/JPG/WEBP/GIF)",
        )

    data = await file.read()
    size_bytes = len(data)
    if size_bytes == 0:
        raise HTTPException(status_code=400, detail="文件为空")
    if size_bytes > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大 ({size_bytes/1024/1024:.1f}MB),当前上限 {MAX_UPLOAD_BYTES // 1024 // 1024}MB",
        )

    material_id = str(uuid.uuid4())
    ext = _extension(file.filename, mime)
    storage_path = f"{user.id}/{material_id}.{ext}"

    client = get_admin_client()
    try:
        # supabase-py 是 sync 的,放到线程里跑避免阻塞 event loop
        await asyncio.to_thread(
            lambda: client.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                data,
                file_options={
                    "content-type": mime,
                    "upsert": "true",
                },
            )
        )
    except Exception as exc:
        logger.exception("upload to storage failed")
        raise HTTPException(
            status_code=502,
            detail=f"上传到 Storage 失败: {exc}",
        ) from exc

    row = repos.insert_material(
        {
            "id": material_id,
            "owner_type": "student",
            "owner_id": user.id,
            "group_id": group_id,  # Phase 7: null=个人; 有值=群共享
            "title": (title or file.filename).strip() or file.filename,
            "subject_id": subject_id,
            "grade": grade,
            "material_type": material_type,
            "storage_path": storage_path,
            "original_filename": file.filename,
            "mime_type": mime,
            "size_bytes": size_bytes,
            "parse_status": "pending",
        }
    )

    background.add_task(_run_processing, material_id)

    return Material.model_validate(row)


async def _run_processing(material_id: str) -> None:
    """BackgroundTasks 兼容入口。捕获顶层异常,绝不让 task crash 影响进程。"""
    try:
        await material_processor.process_material(material_id)
    except Exception:
        logger.exception("background processing crashed: %s", material_id)


@router.get("", response_model=list[Material])
async def list_my_materials(
    scope: str = Query(default="personal", pattern="^(personal|group|all)$"),
    group_id: str | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> list[Material]:
    """列出资料。Phase 7 起 scope 语义:

    - `personal` (默认): 个人资料 + 平台公共
    - `group` + `group_id=xxx`: 某个群下的所有资料 (调用者必须是该群成员)
    - `all`: 个人 + 平台 + 我加入的所有群
    """
    if scope == "group":
        if not group_id:
            raise HTTPException(status_code=400, detail="scope=group 时必须传 group_id")
        if not repos.get_group_member(group_id, user.id):
            raise HTTPException(status_code=403, detail="你不是该群成员")
        rows = repos.list_materials(user.id, scope="group", group_id=group_id)
    elif scope == "all":
        gids = repos.list_my_group_ids(user.id)
        rows = repos.list_materials(user.id, scope="all", group_ids=gids)
    else:
        rows = repos.list_materials(user.id, scope="personal")
    return [Material.model_validate(r) for r in rows]


@router.get("/{material_id}", response_model=Material)
async def get_material(
    material_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Material:
    # 先尝试 owner/平台读取; 拿不到再看是不是群成员
    row = repos.get_material(material_id, user.id)
    if not row:
        raw = repos.get_material_by_id(material_id)
        if raw and raw.get("group_id") and repos.get_group_member(raw["group_id"], user.id):
            row = raw
    if not row:
        raise HTTPException(status_code=404, detail="资料不存在或无权访问")
    return Material.model_validate(row)


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    # 权限模型 (Phase 7):
    #   - 个人资料 (group_id=null): 仅本人可删
    #   - 群资料 (group_id!=null): 本人 (创建者) 可删; 或群 owner/admin 可删
    raw = repos.get_material_by_id(material_id)
    if not raw:
        raise HTTPException(status_code=404, detail="资料不存在")

    gid = raw.get("group_id")
    can_delete = raw.get("owner_id") == user.id
    if not can_delete and gid:
        m = repos.get_group_member(gid, user.id)
        if m and m.get("role") in ("owner", "admin"):
            can_delete = True
    if not can_delete:
        raise HTTPException(status_code=403, detail="无权删除该资料")

    # 直接按 id 删 (绕过 delete_material 里的 owner_id 校验)
    client = get_admin_client()
    del_resp = client.table("learning_materials").delete().eq("id", material_id).execute()
    if not del_resp.data:
        raise HTTPException(status_code=404, detail="资料不存在")

    storage_path = raw.get("storage_path")
    if storage_path:
        try:
            await asyncio.to_thread(
                lambda: client.storage.from_(STORAGE_BUCKET).remove([storage_path])
            )
        except Exception:
            logger.warning("storage remove failed for %s (row already gone)", storage_path)
