#!/usr/bin/env bash
# 生产环境后端启动脚本 (自有服务器)
# - 自动激活 venv,装依赖
# - 用 uvicorn 多 worker 启动
# - 监听 0.0.0.0 让反向代理可以转发
#
# 用法 (前台):
#   ./deploy/start_prod.sh
# 用法 (systemd):
#   见 deploy/student-coach-api.service.example

set -euo pipefail

# 切到仓库根 (脚本位于 deploy/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT/api"

# 1. venv 准备
if [ ! -d .venv ]; then
  echo "→ 创建 venv"
  python3 -m venv .venv
fi
source .venv/bin/activate

# 2. 依赖
echo "→ 安装/更新依赖"
pip install -q --upgrade pip
pip install -q -r requirements.txt

# 3. 加载 .env (systemd 会自己用 EnvironmentFile,但前台跑时也要让 settings 读到)
if [ -f "$REPO_ROOT/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +o allexport
fi

# 4. 启动
PORT="${BACKEND_PORT:-8000}"
WORKERS="${BACKEND_WORKERS:-2}"
LOG_LEVEL_LC="$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')"

echo "→ 启动 uvicorn host=0.0.0.0 port=$PORT workers=$WORKERS log=$LOG_LEVEL_LC"
export PYTHONUNBUFFERED=1
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers "$WORKERS" \
  --log-level "$LOG_LEVEL_LC" \
  --no-access-log \
  --proxy-headers \
  --forwarded-allow-ips='*'
