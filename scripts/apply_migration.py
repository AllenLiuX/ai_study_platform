#!/usr/bin/env python
"""把一个 .sql 文件直接打到远端 Supabase Postgres。

依赖 DATABASE_URL 在 .env (postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres)
内部用 psycopg 同步直连,执行整个文件。

用法:
  python scripts/apply_migration.py supabase/migrations/0003_phase2_progress.sql
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sql_path", type=Path)
    args = parser.parse_args()

    if not args.sql_path.exists():
        print(f"✗ 文件不存在: {args.sql_path}")
        return 1

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("✗ DATABASE_URL 未配置")
        return 1

    sql_text = args.sql_path.read_text(encoding="utf-8")
    print(f"→ 应用 migration: {args.sql_path.name} ({len(sql_text)} chars)")

    try:
        with psycopg.connect(dsn, autocommit=True, connect_timeout=20) as conn:
            with conn.cursor() as cur:
                cur.execute(sql_text)
                # psycopg.execute 会一次性执行整段 SQL (multi-statement)
                print(f"✓ 已应用 {args.sql_path.name}")
    except Exception as exc:
        print(f"✗ 执行失败: {exc}")
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
