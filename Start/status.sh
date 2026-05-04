#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.polarclaw.pid"

if [ ! -f "$PID_FILE" ]; then echo "stopped"; exit 1; fi

TARGET_PID=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -z "$TARGET_PID" ] || ! kill -0 "$TARGET_PID" 2>/dev/null; then
    echo "stopped"
    exit 1
fi

echo "running pid=$TARGET_PID"
exit 0
