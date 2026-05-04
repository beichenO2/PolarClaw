#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.polarclaw.pid"

cd "$PROJECT_DIR"

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "pid=$OLD_PID"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

nohup npm start > /dev/null 2>&1 &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"

sleep 3
if kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "pid=$DAEMON_PID"
    exit 0
fi

echo "Process exited immediately" >&2
rm -f "$PID_FILE"
exit 1
