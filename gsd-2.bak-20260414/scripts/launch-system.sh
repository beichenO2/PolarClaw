#!/bin/bash
# DEPRECATED: Use launch-cluster.sh instead!
# This script lacks project isolation and is unsafe for multi-project use.
echo "ERROR: launch-system.sh 已废弃！"
echo "       请使用: ./scripts/launch-cluster.sh [NUM_WORKERS]"
echo "       launch-cluster.sh 支持项目隔离、指数退避、多项目安全"
exit 1

# --- Original code below (kept for reference) ---

set -euo pipefail

AGENT_COUNT="${1:-100}"
PROJECT_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
HUB_PORT="${GSD_HUB_PORT:-8765}"
HUB_URL="http://127.0.0.1:${HUB_PORT}/mcp"
LOG_DIR="${PROJECT_DIR}/.planning/logs"
HUB_LOG="${LOG_DIR}/hub.log"

mkdir -p "$LOG_DIR"
mkdir -p "${PROJECT_DIR}/.planning/reports/proxy"
mkdir -p "${PROJECT_DIR}/.planning/reports/controller"
mkdir -p "${PROJECT_DIR}/.planning/reports/supervisor"
mkdir -p "${PROJECT_DIR}/.planning/reports/clk"
mkdir -p "${PROJECT_DIR}/.planning/reports/workers"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " gsd-2 MULTI-AGENT SYSTEM LAUNCHER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo " Agents:     ${AGENT_COUNT}"
echo " Project:    ${PROJECT_DIR}"
echo " Hub URL:    ${HUB_URL}"
echo " Logs:       ${LOG_DIR}"
echo ""

# Step 1: Start Hub
echo "[1/3] Starting MCP Hub..."
tmux kill-session -t "gsd2-hub" 2>/dev/null || true
tmux new-session -d -s "gsd2-hub" -x 200 -y 50
tmux send-keys -t "gsd2-hub" "cd '${PROJECT_DIR}' && GSD_CLK_DISABLED=0 npm run start 2>&1 | tee '${HUB_LOG}'" Enter
sleep 3

# Verify hub is running
if curl -s "http://127.0.0.1:${HUB_PORT}/mcp" -X POST -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1; then
  echo "  ✓ Hub is running on port ${HUB_PORT}"
else
  echo "  ⚠ Hub may not be ready yet (this is normal, it takes a few seconds)"
fi

# Step 2: Launch agent sessions
echo ""
echo "[2/3] Launching ${AGENT_COUNT} agent sessions..."

LAUNCHED=0
FAILED=0

for i in $(seq 0 $((AGENT_COUNT - 1))); do
  AGENT_ID=$(printf "agent-%03d" "$i")
  TMUX_SESSION="gsd2-${AGENT_ID}"
  AGENT_LOG="${LOG_DIR}/${AGENT_ID}.log"

  # Kill existing
  tmux kill-session -t "${TMUX_SESSION}" 2>/dev/null || true

  # Create session
  if tmux new-session -d -s "${TMUX_SESSION}" -x 200 -y 50 2>/dev/null; then
    tmux send-keys -t "${TMUX_SESSION}" "cd '${PROJECT_DIR}'" Enter
    LAUNCHED=$((LAUNCHED + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  # Progress every 10
  if [ $(( (i + 1) % 10 )) -eq 0 ]; then
    echo "  ... ${LAUNCHED} launched, ${FAILED} failed"
  fi
done

echo "  ✓ ${LAUNCHED} sessions created, ${FAILED} failed"

# Step 3: Summary
echo ""
echo "[3/3] System ready for activation"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " NEXT STEPS:"
echo ""
echo " The Proxy (you, in this Cursor chat) now needs to:"
echo " 1. Start CLI agents in each tmux session"
echo " 2. Register them with the Hub"
echo " 3. Assign management roles"
echo " 4. Ask the user: 'Is startup complete?'"
echo ""
echo " To start agents in sessions:"
echo "   tmux send-keys -t gsd2-agent-001 \"cursor agent --print --yolo '...'\" Enter"
echo ""
echo " To watch hub logs:"
echo "   tail -f ${HUB_LOG}"
echo ""
echo " To list all sessions:"
echo "   tmux list-sessions | grep gsd2"
echo ""
echo " To kill everything:"
echo "   tmux kill-server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
