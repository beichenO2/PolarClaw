#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.polarclaw.pid"
SERVICE_NAME="polarclaw-web"
PROJECT="PolarClaw"
PREFERRED_PORT=3910

cd "$PROJECT_DIR"

# ── Dynamic port allocation via PolarPort ────────────
source "$PROJECT_DIR/../Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "$SERVICE_NAME" "$PROJECT" "$PREFERRED_PORT")

# Load nvm to match the Node version used by `npm start`
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use --silent 2>/dev/null || true
fi

is_port_listening() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t >/dev/null 2>&1
}

get_port_pid() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true
}

if is_port_listening; then
    OCCUPANT_PID=$(get_port_pid)
    echo "pid=$OCCUPANT_PID"
    echo "port=$PORT"
    exit 0
fi

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "pid=$OLD_PID"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

# Auto-rebuild native modules if Node version changed
NATIVE_CHECK=$(node -e "try{require('better-sqlite3');console.log('ok')}catch{console.log('rebuild')}" 2>/dev/null || echo "rebuild")
if [ "$NATIVE_CHECK" = "rebuild" ]; then
    npm rebuild better-sqlite3 >/dev/null 2>&1 || true
fi

LOG_FILE="$PROJECT_DIR/.data/polarclaw.log"
mkdir -p "$(dirname "$LOG_FILE")"
PORT="$PORT" nohup node dist/main.js > "$LOG_FILE" 2>&1 &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"

for i in $(seq 1 30); do
    if is_port_listening; then
        ACTUAL_PID=$(get_port_pid || echo "$DAEMON_PID")
        echo "pid=$ACTUAL_PID"
        echo "port=$PORT"
        exit 0
    fi
    sleep 1
done

echo "Timed out waiting for port $PORT" >&2
rm -f "$PID_FILE"
exit 1
