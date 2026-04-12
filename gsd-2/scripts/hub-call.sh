#!/bin/bash
# hub-call.sh — Call gsd-2 Hub MCP tools via curl with persistent sessions
#
# Usage:
#   ./hub-call.sh <agent_id> <tool_name> '<json_args>'
#
# Examples:
#   ./hub-call.sh proxy-001 hub_register '{"agent_id":"proxy-001"}'
#   ./hub-call.sh proxy-001 hub_get_roles '{}'
#   ./hub-call.sh worker-001 hub_claim_task '{"agent_id":"worker-001"}'
#
# The agent_id is used to persist the session ID across calls.
# Session files are stored in /tmp/gsd2-<PROJECT_HASH>-<agent_id>.
#
# Environment:
#   GSD_HUB_PORT    — Hub port (default: auto-derived from GSD_PROJECT_HASH, fallback 8765)
#   GSD_PROJECT_HASH — 4-char project isolation prefix (auto-derived from pwd if unset)
#   HUB_URL         — Full Hub endpoint (overrides port)

set -euo pipefail

# Project isolation: derive a 4-char hash from project dir for unique namespacing
if [ -z "${GSD_PROJECT_HASH:-}" ]; then
  _proj_dir="${GSD_PROJECT_DIR:-$(pwd)}"
  GSD_PROJECT_HASH=$(printf '%s' "$_proj_dir" | md5sum 2>/dev/null | cut -c1-4 || printf '%s' "$_proj_dir" | md5 -q 2>/dev/null | cut -c1-4 || echo "0000")
fi
export GSD_PROJECT_HASH

# Deterministic port: 10000 + (hash as hex -> decimal) % 55535, range 10000-65534
if [ -z "${GSD_HUB_PORT:-}" ]; then
  GSD_HUB_PORT=$(python3 -c "print(10000 + int('${GSD_PROJECT_HASH}', 16) % 55535)" 2>/dev/null || echo "8765")
fi

HUB_URL="${HUB_URL:-http://127.0.0.1:${GSD_HUB_PORT}/mcp}"
AGENT_KEY="${1:?Usage: hub-call.sh <agent_id> <tool_name> '<json_args>'}"
TOOL_NAME="${2:?Usage: hub-call.sh <agent_id> <tool_name> '<json_args>'}"
TOOL_ARGS="${3:-\{\}}"
MAX_RETRIES=3
CONNECT_TIMEOUT=5
MAX_TIME=30

ACCEPT="application/json, text/event-stream"
SESSION_FILE="/tmp/gsd2-${GSD_PROJECT_HASH}-${AGENT_KEY}"

get_session() {
  if [ -f "$SESSION_FILE" ]; then
    cat "$SESSION_FILE"
    return
  fi

  local INIT_RESP
  INIT_RESP=$(curl -si "$HUB_URL" -X POST \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$MAX_TIME" \
    -H "Content-Type: application/json" \
    -H "Accept: $ACCEPT" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"'"$AGENT_KEY"'","version":"1.0"}},"id":0}' 2>/dev/null)

  local SID
  SID=$(echo "$INIT_RESP" | grep -i '^mcp-session-id:' | tr -d '\r\n' | awk '{print $2}')

  if [ -z "$SID" ]; then
    return 1
  fi

  echo "$SID" > "$SESSION_FILE"
  echo "$SID"
}

call_tool() {
  local SID="$1"
  curl -s "$HUB_URL" -X POST \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$MAX_TIME" \
    -H "Content-Type: application/json" \
    -H "Accept: $ACCEPT" \
    -H "mcp-session-id: $SID" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL_NAME\",\"arguments\":$TOOL_ARGS},\"id\":1}" 2>/dev/null
}

needs_retry() {
  local RESP="$1"
  [ -z "$RESP" ] && return 0
  echo "$RESP" | grep -q '"Session not found"' && return 0
  echo "$RESP" | grep -q '"not_registered"' && return 0
  local DATA_LINE
  DATA_LINE=$(echo "$RESP" | grep '^data: ' | head -1 | sed 's/^data: //')
  [ -z "$DATA_LINE" ] && return 0
  return 1
}

ATTEMPT=0
TOOL_RESP=""

while [ $ATTEMPT -lt $MAX_RETRIES ]; do
  ATTEMPT=$((ATTEMPT + 1))

  SESSION_ID=$(get_session) || {
    rm -f "$SESSION_FILE"
    [ $ATTEMPT -lt $MAX_RETRIES ] && sleep 1 && continue
    echo '{"ok":false,"error":"failed_to_initialize_session","attempts":'$ATTEMPT'}' >&2
    exit 1
  }

  TOOL_RESP=$(call_tool "$SESSION_ID")

  if needs_retry "$TOOL_RESP"; then
    rm -f "$SESSION_FILE"
    [ $ATTEMPT -lt $MAX_RETRIES ] && sleep 1 && continue
  else
    break
  fi
done

DATA_LINE=$(echo "$TOOL_RESP" | grep '^data: ' | head -1 | sed 's/^data: //')

if [ -z "$DATA_LINE" ]; then
  echo '{"ok":false,"error":"empty_response_after_retries","attempts":'$ATTEMPT',"raw":"'"$(echo "$TOOL_RESP" | tr '\n' ' ' | head -c 200)"'"}' >&2
  exit 1
fi

echo "$DATA_LINE" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read().strip())
r=d.get('result',{})
for c in r.get('content',[]):
    if c.get('type')=='text':
        print(json.dumps(json.loads(c['text']),indent=2,ensure_ascii=False))
        sys.exit(0)
if 'error' in d:
    print(json.dumps(d['error'],indent=2,ensure_ascii=False))
    sys.exit(1)
print(json.dumps(d,indent=2,ensure_ascii=False))
"
