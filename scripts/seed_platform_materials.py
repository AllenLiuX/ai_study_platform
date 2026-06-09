#!/usr/bin/env python
"""
把 seed-data/platform/<subject>/*.md 里的 AI 讲义批量入库为「平台公共资料」。

流程 (单个文件):
  1. 读 .md → 提取首行作为标题
  2. 用 service_role 上传到 Supabase Storage:bucket=materials, key=platform/<uuid>.md
  3. INSERT learning_materials(owner_type='platform', owner_id=null, ...)
  4. 复用 material_processor.process_material 完成 parse + chunk + embed

幂等性:
  - 默认按 storage_path 关联同一份 .md (固定 source_filename 作为 storage_key 是不可行的因为我们用 uuid)
  - 改用 title + owner_type='platform' 唯一性来判断:已存在的同名 platform 资料跳过,加 --force 删了重传

用法:
  python scripts/seed_platform_materials.py                       # 全部学科
  python scripts/seed_platform_materials.py --subject math
  python scripts/seed_platform_materials.py --force               # 同名删除后重传

要求:
  - SUPABASE_SERVICE_ROLE_KEY 必须在 .env 里
  - 在 api/ 目录的 venv 中运行 (依赖 supabase / openai / pypdf / tiktoken)
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from app.core.config import get_settings  # noqa: E402
from app.db import repos  # noqa: E402
from app.db.supabase_client import get_admin_client  # noqa: E402
from app.services import material_processor  # noqa: E402

PLATFORM_DIR = ROOT / "seed-data" / "platform"
STORAGE_BUCKET = "materials"
STORAGE_PREFIX = "platform"


def _extract_title(md_text: str, fallback: str) -> str:
    """取首个 # 一级标题作为资料标题。"""
    for line in md_text.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def _find_existing_platform(*, title: str, subject_id: str) -> dict | None:
    """按 title + subject_id + owner_type='platform' 查重。"""
    client = get_admin_client()
    resp = (
        client.table("learning_materials")
        .select("*")
        .eq("owner_type", "platform")
        .eq("title", title)
        .eq("subject_id", subject_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def _delete_platform_material(material: dict) -> None:
    """删除 platform 资料 (DB 行 + storage 文件)。"""
    client = get_admin_client()
    try:
        client.storage.from_(STORAGE_BUCKET).remove([material["storage_path"]])
    except Exception as exc:
        print(f"  ⚠ 删除 storage 文件失败 (忽略,继续): {exc}")
    client.table("learning_materials").delete().eq("id", material["id"]).execute()


def _upload_md_to_storage(material_id: str, md_text: str) -> str:
    """把 md 上传到 platform/<material_id>.md,返回 storage_path。"""
    storage_path = f"{STORAGE_PREFIX}/{material_id}.md"
    client = get_admin_client()
    client.storage.from_(STORAGE_BUCKET).upload(
        path=storage_path,
        file=md_text.encode("utf-8"),
        file_options={
            "content-type": "text/markdown",
            "upsert": "true",
        },
    )
    return storage_path


async def seed_one_md(
    *, md_path: Path, subject_id: str, force: bool
) -> tuple[bool, str]:
    """处理一个 markdown 文件。返回 (success, info_msg)。"""
    md_text = md_path.read_text(encoding="utf-8")
    title = _extract_title(md_text, fallback=md_path.stem)
    size_bytes = len(md_text.encode("utf-8"))

    existing = _find_existing_platform(title=title, subject_id=subject_id)
    if existing:
        if not force:
            return False, f"skip (已存在 platform: {existing['id'][:8]})"
        print(f"  · force 模式,删除旧 platform 资料 {existing['id'][:8]}…")
        _delete_platform_material(existing)

    material_id = str(uuid.uuid4())
    storage_path = _upload_md_to_storage(material_id, md_text)

    repos.insert_material(
        {
            "id": material_id,
            "owner_type": "platform",
            "owner_id": None,
            "title": title,
            "subject_id": subject_id,
            "material_type": "handout",
            "storage_path": storage_path,
            "original_filename": md_path.name,
            "mime_type": "text/markdown",
            "size_bytes": size_bytes,
            "parse_status": "pending",
        }
    )

    await material_processor.process_material(material_id)
    fresh = repos.get_material_by_id(material_id)
    chunk_count = (fresh or {}).get("chunk_count", 0)
    status = (fresh or {}).get("parse_status", "?")
    return status == "ready", f"{status} · {chunk_count} chunks"


async def main_async(args: argparse.Namespace) -> int:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        print("✗ Supabase 未配置")
        return 1

    subjects = (
        [args.subject]
        if args.subject
        else sorted([p.name for p in PLATFORM_DIR.iterdir() if p.is_dir()])
    )

    total_ok = total_skip = total_fail = 0
    for subject_id in subjects:
        subject_dir = PLATFORM_DIR / subject_id
        if not subject_dir.exists():
            print(f"\n=== {subject_id} === (不存在,跳过)")
            continue
        md_files = sorted(subject_dir.glob("*.md"))
        print(f"\n=== {subject_id} === ({len(md_files)} 份)")
        for md_path in md_files:
            print(f"  → {md_path.name}")
            try:
                ok, info = await seed_one_md(
                    md_path=md_path, subject_id=subject_id, force=args.force
                )
                if "skip" in info:
                    total_skip += 1
                elif ok:
                    total_ok += 1
                else:
                    total_fail += 1
                print(f"    {info}")
            except Exception as exc:
                total_fail += 1
                print(f"    ✗ 失败: {exc}")

    print(f"\n汇总:成功 {total_ok} · 跳过 {total_skip} · 失败 {total_fail}")
    return 0 if total_fail == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="把 AI 讲义入库到 Supabase 作为平台公共资料")
    parser.add_argument("--subject", help="只处理某学科 (math / english / chinese)")
    parser.add_argument(
        "--force",
        action="store_true",
        help="如果同名 platform 资料已存在,先删旧的再传新的",
    )
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
