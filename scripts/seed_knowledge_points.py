#!/usr/bin/env python
"""把 seed-data/knowledge-points/*.yaml 里的知识点树 upsert 到 Supabase。

幂等:同 id 的知识点会被 upsert,前后 schema 一致。

用法:
  python scripts/seed_knowledge_points.py            # 全部学科
  python scripts/seed_knowledge_points.py --subject math
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from app.db.supabase_client import get_admin_client  # noqa: E402

KP_DIR = ROOT / "seed-data" / "knowledge-points"


def upsert_kps(rows: list[dict]) -> None:
    if not rows:
        return
    client = get_admin_client()
    client.table("knowledge_points").upsert(rows, on_conflict="id").execute()


def seed_subject(yaml_path: Path) -> tuple[int, int]:
    """处理单个学科 yaml,返回 (chapters_count, leaves_count)。"""
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    subject_id = data["subject_id"]
    stage = data.get("stage")
    chapters = data["chapters"]

    chapter_rows: list[dict] = []
    leaf_rows: list[dict] = []

    for ch_idx, ch in enumerate(chapters):
        chapter_rows.append(
            {
                "id": ch["id"],
                "subject_id": subject_id,
                "parent_id": None,
                "name": ch["name"],
                "stage": stage,
                "level": 0,
                "is_leaf": False,
                "sort_order": ch_idx,
            }
        )
        for leaf_idx, leaf in enumerate(ch.get("leaves", [])):
            leaf_rows.append(
                {
                    "id": leaf["id"],
                    "subject_id": subject_id,
                    "parent_id": ch["id"],
                    "name": leaf["name"],
                    "description": leaf.get("description"),
                    "stage": stage,
                    "level": 1,
                    "is_leaf": True,
                    "sort_order": leaf_idx,
                }
            )

    upsert_kps(chapter_rows)
    upsert_kps(leaf_rows)
    return len(chapter_rows), len(leaf_rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", help="只处理某学科 (math / english / chinese)")
    args = parser.parse_args()

    yaml_files = sorted(KP_DIR.glob("*.yaml"))
    if args.subject:
        yaml_files = [p for p in yaml_files if p.stem.startswith(args.subject)]
    if not yaml_files:
        print(f"✗ 没找到匹配的 yaml: subject={args.subject}")
        return 1

    total_ch = total_lf = 0
    for p in yaml_files:
        ch, lf = seed_subject(p)
        print(f"  {p.name}: {ch} chapters · {lf} leaves")
        total_ch += ch
        total_lf += lf

    print(f"\n汇总: {total_ch} chapters · {total_lf} leaves 入库")
    return 0


if __name__ == "__main__":
    sys.exit(main())
