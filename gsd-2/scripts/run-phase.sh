#!/bin/bash
# gsd-2: Run a phase via Cursor CLI in tmux (project-isolated)
# Usage: ./scripts/run-phase.sh [phase_number]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

PHASE="${1:-1}"
LOG_DIR="${PROJECT_DIR}/.planning/logs"
LOG_FILE="${LOG_DIR}/phase-${PHASE}-$(date +%Y%m%d-%H%M%S).log"
SESSION_NAME="${TMUX_PREFIX}-phase-${PHASE}"

mkdir -p "$LOG_DIR"

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " gsd-2 ► LAUNCHING PHASE ${PHASE} [$GSD_PROJECT_HASH]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

tmux new-session -d -s "$SESSION_NAME" -x 200 -y 50
tmux send-keys -t "$SESSION_NAME" "cd '$PROJECT_DIR'" Enter
sleep 1
tmux send-keys -t "$SESSION_NAME" "cursor agent --print --yolo --workspace '$PROJECT_DIR' 'Read the file .planning/phase-${PHASE}-prompt.md for full instructions. Execute all instructions exactly. Do not ask questions.' 2>&1 | tee '$LOG_FILE'" Enter

echo ""
echo "Agent launched in tmux session '${SESSION_NAME}'"
echo ""
echo "  tmux attach -t ${SESSION_NAME}       — Watch live"
echo "  tmux kill-session -t ${SESSION_NAME}  — Stop"
echo "  tail -f '${LOG_FILE}'                — Follow logs"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
