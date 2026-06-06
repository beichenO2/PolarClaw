#!/bin/bash
set -euo pipefail

SERVICE_ID="polarclaw"
PORT=3910
POLARPROCESS_URL="${POLARPROCESS_URL:-http://127.0.0.1:11055}"

# Tier 1: PolarProcess query
if curl -sf "$POLARPROCESS_URL/api/health" >/dev/null 2>&1; then
    STATUS=$(curl -sf "$POLARPROCESS_URL/api/processes/$SERVICE_ID" 2>/dev/null || echo '{}')
    PID=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pid',''))" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "running pid=$PID (via PolarProcess)"
        exit 0
    fi
fi

# Tier 2: port check
PID=$(lsof -iTCP:$PORT -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
if [ -n "$PID" ]; then
    echo "running pid=$PID"
    exit 0
fi

echo "stopped"
exit 1
