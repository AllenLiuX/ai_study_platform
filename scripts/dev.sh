#!/usr/bin/env bash
# 同时启动前后端 (开发模式)
# 用法: ./scripts/dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "❌ 找不到 $ROOT/.env, 请先复制 .env.example 为 .env 并填入 Supabase keys"
  exit 1
fi

# macOS 默认 file descriptor 上限较低 (256/1024),会导致 Next.js 文件监听 EMFILE,
# 进而 route 发现失败 (访问任何页面都 404)。这里临时提到一个安全值。
if [[ "$(uname)" == "Darwin" ]]; then
  ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true
fi

# Next.js 默认从 web/.env.local 读取 NEXT_PUBLIC_* 变量,
# 我们用 symlink 让它复用根目录 .env,避免双份维护。
if [[ ! -e "$ROOT/web/.env.local" ]]; then
  ln -s ../.env "$ROOT/web/.env.local"
fi

cleanup() {
  echo
  echo "正在关闭子进程..."
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "🟢 启动 FastAPI 后端 (port 8000)..."
(
  cd "$ROOT/api"
  if [[ ! -d .venv ]]; then
    echo "  ↳ 第一次启动,创建 venv 并安装依赖..."
    python3 -m venv .venv
    .venv/bin/pip install --quiet --upgrade pip
    .venv/bin/pip install --quiet -r requirements.txt
  fi
  .venv/bin/uvicorn app.main:app --reload --port 8000
) &
API_PID=$!

echo "🟢 启动 Next.js 前端 (port 3000)..."
(
  cd "$ROOT/web"
  if [[ ! -d node_modules ]]; then
    echo "  ↳ 第一次启动,执行 npm install..."
    npm install --no-audit --no-fund
  fi
  npm run dev
) &
WEB_PID=$!

echo
echo "前端 PID: $WEB_PID  后端 PID: $API_PID"
echo "前端访问: http://localhost:3000"
echo "后端 API: http://localhost:8000/docs"
echo "按 Ctrl+C 同时停止"
echo

wait
