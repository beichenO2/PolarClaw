#!/bin/bash
# smoke-test.sh — Quick Hub connectivity smoke test (< 5 seconds)
#
# Verifies: Hub reachable → register → create task → claim → complete
# Uses project-isolated port from lib-isolate.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

echo "Smoke test (port $HUB_PORT)..."

if ! curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then
  echo "FAIL: Hub not reachable"
  exit 1
fi

rm -f /tmp/gsd2-session-smoke-$$

R=$("$HUB_CALL" "smoke-$$" hub_register '{"agent_id":"smoke-test"}' 2>/dev/null)
echo "$R" | grep -q '"ok": true' || { echo "FAIL: register"; exit 1; }

R=$("$HUB_CALL" "smoke-$$" hub_create_task '{"creator_agent_id":"smoke-test","title":"smoke","workflow_stage":"verify","priority":1}' 2>/dev/null)
TID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['task']['id'])" 2>/dev/null)
[ -z "$TID" ] && { echo "FAIL: create_task"; exit 1; }

R=$("$HUB_CALL" "smoke-$$" hub_claim_task '{"agent_id":"smoke-test","workflow_stage":"verify"}' 2>/dev/null)
CLAIMED=$(echo "$R" | python3 -c "import sys,json;t=json.load(sys.stdin).get('task');print(t['id'] if t else '')" 2>/dev/null)
[ -z "$CLAIMED" ] && { echo "FAIL: claim_task (null)"; exit 1; }
TID="$CLAIMED"

R=$("$HUB_CALL" "smoke-$$" hub_complete_task "{\"agent_id\":\"smoke-test\",\"task_id\":\"$TID\",\"result_summary\":\"smoke OK\"}" 2>/dev/null)
echo "$R" | grep -q '"done"' || { echo "FAIL: complete_task"; exit 1; }

rm -f "/tmp/gsd2-session-smoke-$$"
echo "PASS (register → create → claim → complete)"
