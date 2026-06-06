#!/bin/bash
set -euo pipefail

SERVICE_ID="polarclaw"
POLARPROCESS_URL="${POLARPROCESS_URL:-http://127.0.0.1:11055}"
POLARPORT_URL="${POLARPORT_URL:-http://127.0.0.1:11050}"
PORT=3910

# Tier 1: PolarProcess API
if curl -sf "$POLARPROCESS_URL/api/health" >/dev/null 2>&1; then
    STATUS=$(curl -sf -X POST "$POLARPROCESS_URL/api/services/$SERVICE_ID/stop" 2>/dev/null || echo '{"ok":false}')
    if echo "$STATUS" | grep -q '"ok":true'; then
        echo "stopped via PolarProcess"
        exit 0
    fi
fi

# Tier 2: PolarPort lookup → kill
PID=$(curl -sf "$POLARPORT_URL/api/list" 2>/dev/null \
    | python3 -c "
import json, sys
for p in json.load(sys.stdin):
    if p.get('port') == $PORT:
        print(p.get('pid', ''))
        break
" 2>/dev/null || true)

if [ -z "$PID" ]; then
    PID=$(lsof -iTCP:$PORT -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
fi

if [ -z "$PID" ]; then
    echo "stopped (not running)"
    exit 0
fi

kill -TERM "$PID" 2>/dev/null || true
for i in $(seq 1 10); do
    if ! kill -0 "$PID" 2>/dev/null; then echo "stopped pid=$PID"; exit 0; fi
    sleep 1
done
kill -KILL "$PID" 2>/dev/null || true
sleep 1
echo "killed pid=$PID"

# Release port in PolarPort
curl -sf -X POST "$POLARPORT_URL/api/release" \
    -H "Content-Type: application/json" \
    -d "{\"port\": $PORT}" >/dev/null 2>&1 || true

exit 0
