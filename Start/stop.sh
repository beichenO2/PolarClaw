#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.polarclaw.pid"
PORT=3910

TARGET_PID=""
if [ -f "$PID_FILE" ]; then
    TARGET_PID=$(cat "$PID_FILE" 2>/dev/null || true)
fi

if [ -z "$TARGET_PID" ] || ! kill -0 "$TARGET_PID" 2>/dev/null; then
    TARGET_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
fi

if [ -z "$TARGET_PID" ]; then
    rm -f "$PID_FILE"
    exit 0
fi

kill -TERM "$TARGET_PID" 2>/dev/null || true
for i in $(seq 1 10); do
    if ! kill -0 "$TARGET_PID" 2>/dev/null; then rm -f "$PID_FILE"; exit 0; fi
    sleep 1
done
kill -KILL "$TARGET_PID" 2>/dev/null || true
sleep 1
rm -f "$PID_FILE"
exit 0
