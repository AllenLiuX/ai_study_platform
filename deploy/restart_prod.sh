#!/usr/bin/env bash
# =============================================================================
# 一键应用最新更新 + 重启生产后端
# 用法 (在仓库根或 deploy/ 下都行):
#   ./deploy/restart_prod.sh
#
# 做的事:
#   1. git pull --ff-only            (无新 commit 也无害,有冲突会立刻退出)
#   2. sudo systemctl restart <svc>  (systemd 内会自动 pip install 新依赖)
#   3. 轮询 /health 直到 ready (最多 30 秒)
#   4. /health/config 打印加载后的实际配置
#
# 退出码 != 0 表示更新失败,请看脚本末尾给的 journalctl 命令排查。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="ai-study-platform-api"
HEALTH_URL="http://127.0.0.1:8000/health"
CONFIG_URL="http://127.0.0.1:8000/health/config"

cd "$REPO_ROOT"

echo "→ [1/4] git pull --ff-only"
git pull --ff-only

echo "→ [2/4] sudo systemctl restart $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "→ [3/4] 等待 $HEALTH_URL 就绪 (最多 30s)"
for i in $(seq 1 30); do
  if curl -sf --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "   ↳ ready in ${i}s"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "❌ 30 秒内 /health 未就绪,最近 40 行日志:"
    sudo journalctl -u "$SERVICE_NAME" -n 40 --no-pager
    exit 1
  fi
  sleep 1
done

echo "→ [4/4] /health/config 自检"
curl -sS "$CONFIG_URL" | python3 -m json.tool

echo
echo "✅ 重启完成"
echo "   - 实时日志:  sudo journalctl -u $SERVICE_NAME -f"
echo "   - 服务状态:  systemctl status $SERVICE_NAME"
echo "   - 公网入口:  https://aico-music.com:5443/health"
