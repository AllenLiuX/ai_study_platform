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

    mime = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    detected = parser.detect_kind(mime, file.filename)
    # Phase 4.1: 在 PDF/text 之外接受图片 — 走 vision_extractor 提取 markdown
    if detected not in {"pdf", "text", "image"}:
        raise HTTPException(
            status_code=400,
            detail="目前支持 PDF / TXT / Markdown / 图片 (PNG/JPG/WEBP/GIF)",
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
    user: CurrentUser = Depends(get_current_user),
) -> list[Material]:
    rows = repos.list_materials(user.id)
    return [Material.model_validate(r) for r in rows]


@router.get("/{material_id}", response_model=Material)
async def get_material(
    material_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Material:
    row = repos.get_material(material_id, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="资料不存在或无权访问")
    return Material.model_validate(row)


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    row = repos.get_material(material_id, user.id)
    if not row or row.get("owner_id") != user.id:
        raise HTTPException(status_code=404, detail="资料不存在或无权删除")

    deleted = repos.delete_material(material_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="资料不存在或无权删除")

    storage_path = row.get("storage_path")
    if storage_path:
        client = get_admin_client()
        try:
            await asyncio.to_thread(
                lambda: client.storage.from_(STORAGE_BUCKET).remove([storage_path])
            )
        except Exception:
            logger.warning("storage remove failed for %s (row already gone)", storage_path)
