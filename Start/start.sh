#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_ID="polarclaw"
PORT=3910
POLARPROCESS_URL="${POLARPROCESS_URL:-http://127.0.0.1:11055}"
POLARPORT_URL="${POLARPORT_URL:-http://127.0.0.1:11050}"

cd "$PROJECT_DIR"

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

# Tier 1: Start via PolarProcess API
if curl -sf "$POLARPROCESS_URL/api/health" >/dev/null 2>&1; then
    # Register first (idempotent)
    curl -sf -X POST "$POLARPROCESS_URL/api/services/register" \
        -H "Content-Type: application/json" \
        -d '{
            "id": "'"$SERVICE_ID"'",
            "name": "PolarClaw Agent",
            "command": "node dist/main.js",
            "work_dir": "'"$PROJECT_DIR"'",
            "port": '"$PORT"',
            "auto_start": true,
            "max_restarts": 30,
            "health_check_url": "http://127.0.0.1:'"$PORT"'/api/status"
        }' >/dev/null 2>&1 || true

    RESULT=$(curl -sf -X POST "$POLARPROCESS_URL/api/services/$SERVICE_ID/start" 2>/dev/null || echo '{"ok":false}')
    if echo "$RESULT" | grep -q '"ok":true'; then
        for i in $(seq 1 30); do
            if is_port_listening; then
                ACTUAL_PID=$(get_port_pid)
                echo "pid=$ACTUAL_PID"
                echo "port=$PORT"
                exit 0
            fi
            sleep 1
        done
    fi
fi

# Tier 2: direct nohup (PolarProcess unavailable)
NATIVE_CHECK=$(node -e "try{require('better-sqlite3');console.log('ok')}catch{console.log('rebuild')}" 2>/dev/null || echo "rebuild")
if [ "$NATIVE_CHECK" = "rebuild" ]; then
    npm rebuild better-sqlite3 >/dev/null 2>&1 || true
fi

LOG_FILE="$PROJECT_DIR/.data/polarclaw.log"
mkdir -p "$(dirname "$LOG_FILE")"
nohup node dist/main.js > "$LOG_FILE" 2>&1 &
DAEMON_PID=$!

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
exit 1
