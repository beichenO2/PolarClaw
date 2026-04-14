#!/bin/bash
# stop-cluster.sh — Gracefully shut down the gsd-2 agent cluster
#
# Usage:
#   ./stop-cluster.sh             (stop everything including Hub)
#   ./stop-cluster.sh --keep-hub  (stop agents, keep Hub running)
#
# Only kills sessions matching this project's prefix (safe for multi-project).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

KEEP_HUB=false
FORCE=false
for arg in "$@"; do
  [ "$arg" = "--keep-hub" ] && KEEP_HUB=true
  [ "$arg" = "--force" ] && FORCE=true
done

# 全局锁检查: 锁定后拒绝关闭 Agent（除非 --force）
if ! $FORCE && "$SCRIPT_DIR/global-lock.sh" check 2>/dev/null; then
  echo "ERROR: 全局资源已锁定，不允许关闭 Agent"
  echo "       Agent 不可关闭，一路跑到死"
  echo "       运行 $SCRIPT_DIR/global-lock.sh status 查看状态"
  echo "       如需紧急关闭，使用 --force 参数"
  exit 1
fi

echo "=== gsd-2 集群关闭 (前缀: $TMUX_PREFIX) ==="

SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" || true)

if [ -z "$SESSIONS" ]; then
  echo "无 ${TMUX_PREFIX}-* sessions"
else
  if ! $KEEP_HUB; then
    HUB_SESSION="${TMUX_PREFIX}-hub"
    if tmux has-session -t "$HUB_SESSION" 2>/dev/null; then
      HUB_PID=$(tmux list-panes -t "$HUB_SESSION" -F '#{pane_pid}' 2>/dev/null | head -1)
      if [ -n "$HUB_PID" ]; then
        for pid in $(pgrep -P "$HUB_PID" 2>/dev/null || true); do
          kill -TERM "$pid" 2>/dev/null || true
        done
        echo "  Hub SIGTERM 已发送"
        sleep 2
      fi
    fi
  fi

  for s in $SESSIONS; do
    if [ "$s" = "${TMUX_PREFIX}-hub" ] && $KEEP_HUB; then
      echo "  保留: $s"
      continue
    fi
    tmux kill-session -t "$s" 2>/dev/null && echo "  关闭: $s" || echo "  跳过: $s"
  done
fi

rm -f /tmp/gsd2-session-*
rm -rf "$PROMPT_DIR"
rm -f "$PROJECT_DIR/.planning/agent-state/launched.json" 2>/dev/null
echo "临时文件已清理（agent-state 保留用于分析）"

REMAINING=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | wc -l | tr -d ' ' || echo "0")
echo ""
echo "完成。剩余 ${TMUX_PREFIX}-* sessions: $REMAINING"
