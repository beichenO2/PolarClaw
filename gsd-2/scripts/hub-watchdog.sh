#!/bin/bash
# hub-watchdog.sh — Monitor Hub health and auto-restart on crash
#
# Usage:
#   ./hub-watchdog.sh              (run in foreground)
#   ./hub-watchdog.sh &            (run in background)
#   ./hub-watchdog.sh --interval 5 (check every 5 seconds)
#
# Typically started by launch-cluster.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

CHECK_INTERVAL="${1:-10}"
MAX_CONSECUTIVE_FAILURES=3

if [ "$CHECK_INTERVAL" = "--interval" ]; then
  CHECK_INTERVAL="${2:-10}"
fi

FAILURES=0

hub_alive() {
  curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"watchdog","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'
}

restart_hub() {
  echo "[$(date +%H:%M:%S)] Hub 崩溃检测到，重启中..."

  for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-hub$" || true); do
    tmux kill-session -t "$s" 2>/dev/null || true
  done

  sleep 1
  mkdir -p "$PROJECT_DIR/.planning/hub" "$PROJECT_DIR/.planning/logs"
  tmux new-session -d -s "${TMUX_PREFIX}-hub" -x 200 -y 50
  tmux send-keys -t "${TMUX_PREFIX}-hub" "conda deactivate 2>/dev/null; export PATH=/opt/homebrew/bin:\$PATH; cd '$GSD2_DIR' && GSD_HUB_PORT=$HUB_PORT GSD_HUB_DB='$PROJECT_DIR/.planning/hub/hub.sqlite' npm run start 2>&1 | tee '$PROJECT_DIR/.planning/logs/hub.log'" Enter

  for i in $(seq 1 15); do
    if hub_alive; then
      echo "[$(date +%H:%M:%S)] Hub 重启成功 (${i}s)"
      rm -f /tmp/gsd2-session-*
      return 0
    fi
    sleep 1
  done

  echo "[$(date +%H:%M:%S)] Hub 重启失败!"
  return 1
}

echo "[$(date +%H:%M:%S)] Hub watchdog 启动 (间隔: ${CHECK_INTERVAL}s, 端口: $HUB_PORT)"

while true; do
  if hub_alive; then
    if [ $FAILURES -gt 0 ]; then
      echo "[$(date +%H:%M:%S)] Hub 恢复正常"
    fi
    FAILURES=0
  else
    FAILURES=$((FAILURES + 1))
    echo "[$(date +%H:%M:%S)] Hub 无响应 ($FAILURES/$MAX_CONSECUTIVE_FAILURES)"

    if [ $FAILURES -ge $MAX_CONSECUTIVE_FAILURES ]; then
      restart_hub && FAILURES=0 || FAILURES=$((FAILURES + 1))
    fi
  fi

  sleep "$CHECK_INTERVAL"
done
