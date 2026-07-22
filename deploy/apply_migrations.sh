#!/usr/bin/env bash
# 一键把 supabase/migrations/*.sql 里所有未跑过的迁移打到 Supabase.
#
# 依赖: psql, 环境变量 DATABASE_POOLER_URL (优先) 或 DATABASE_URL
# 用法:
#   ./deploy/apply_migrations.sh          # 只跑未跑过的
#   ./deploy/apply_migrations.sh 0013     # 只跑指定编号 (前缀匹配)
#   ./deploy/apply_migrations.sh --force  # 忽略已记录, 全部重跑 (幂等 SQL 才行)
#
# 幂等策略: 用一张 schema_migrations 表记录 filename + applied_at, 已记录的跳过.
# 首次运行会自动创建这张表.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 加载 .env
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB="${DATABASE_POOLER_URL:-${DATABASE_URL:-}}"
if [ -z "$DB" ]; then
  echo "❌ 请在 .env 里设 DATABASE_POOLER_URL 或 DATABASE_URL" >&2
  exit 1
fi

FORCE=0
FILTER=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) FILTER="$arg" ;;
  esac
done

# 1. 建 schema_migrations 表 (第一次会创建)
psql "$DB" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
create table if not exists public.schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
);
SQL

# 2. 遍历所有迁移文件
MIG_DIR="$REPO_ROOT/supabase/migrations"
[ -d "$MIG_DIR" ] || { echo "❌ 目录不存在: $MIG_DIR" >&2; exit 1; }

applied_count=0
skipped_count=0
for f in "$MIG_DIR"/*.sql; do
  name="$(basename "$f")"
  [ -n "$FILTER" ] && [[ "$name" != "$FILTER"* ]] && continue

  if [ "$FORCE" -eq 0 ]; then
    already=$(psql "$DB" -tAX -c "select 1 from public.schema_migrations where filename = '$name' limit 1;")
    if [ "$already" = "1" ]; then
      echo "  ↷  skip  $name (已跑过)"
      skipped_count=$((skipped_count+1))
      continue
    fi
  fi

  echo "  ▶  apply $name"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
  psql "$DB" -v ON_ERROR_STOP=1 -q -c \
    "insert into public.schema_migrations(filename) values ('$name')
     on conflict (filename) do update set applied_at = now();" >/dev/null
  echo "  ✓  done  $name"
  applied_count=$((applied_count+1))
done

echo ""
echo "✅ 完成: 新跑 $applied_count, 跳过 $skipped_count"
