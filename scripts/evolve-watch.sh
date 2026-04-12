#!/usr/bin/env bash
# 每 INTERVAL_SEC 秒（默认 300）采集 Hub / tmux / 日志尾部，追加到 .planning/logs/evolve-watch.log
# 你在 IDE 里只盯我时：发一句「读 evolve-watch 汇报」或打开该 log，我就能按快照说明进展。
#
# 启动前（与 gsd-2 v0.2.0 隔离一致）：
#   export GSD_HUB_PORT=57844
#   export GSD_PROJECT_HASH=bae4
#   export TMUX_PREFIX=g-bae4   # 可选，默认 g-${GSD_PROJECT_HASH}
#
# 前台循环：  ./scripts/evolve-watch.sh
# 后台：      nohup ./scripts/evolve-watch.sh >> .planning/logs/evolve-watch.nohup.log 2>&1 &

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p .planning/logs

OUT="${EVOLVE_WATCH_LOG:-$ROOT/.planning/logs/evolve-watch.log}"
HUB_PORT="${GSD_HUB_PORT:-57844}"
HASH="${GSD_PROJECT_HASH:-bae4}"
PREFIX="${TMUX_PREFIX:-g-${HASH}}"
INTERVAL_SEC="${INTERVAL_SEC:-300}"
HUB_LOG="$ROOT/.planning/logs/hub.log"
ONCE=false
[[ "${1:-}" == "--once" ]] && ONCE=true

hub_ok() {
  curl -sS --max-time 3 "http://127.0.0.1:${HUB_PORT}/mcp" -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"evolve-watch","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'
}

snapshot() {
  {
    echo "======== $(date -Iseconds) evolve-watch ========"
    echo "HUB_PORT=${HUB_PORT} TMUX_PREFIX=${PREFIX}"
    if hub_ok; then
      echo "hub_mcp: OK"
    else
      echo "hub_mcp: FAIL (curl :${HUB_PORT}/mcp)"
    fi
    echo "--- tmux (matching ${PREFIX}-*) ---"
    tmux list-sessions 2>/dev/null | grep -E "^${PREFIX}-" || echo "(none)"
    echo "--- tail hub.log (last 20 lines) ---"
    if [[ -f "$HUB_LOG" ]]; then
      tail -n 20 "$HUB_LOG"
    else
      echo "(no $HUB_LOG)"
    fi
    echo ""
  } >>"$OUT"
}

if $ONCE; then
  snapshot
  echo "[evolve-watch] --once wrote to $OUT"
  exit 0
fi

echo "[evolve-watch] logging to $OUT every ${INTERVAL_SEC}s (Ctrl+C to stop)"
while true; do
  snapshot
  sleep "$INTERVAL_SEC"
done
