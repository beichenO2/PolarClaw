#!/bin/bash
# lib-isolate.sh — Project isolation primitives for gsd-2
#
# Source this file to get project-scoped tmux prefix and Hub port.
# Prevents cross-project session/port collisions.
#
# Usage:
#   source "$(dirname "$0")/lib-isolate.sh"
#   echo "$TMUX_PREFIX"  # e.g. g-a1b2
#   echo "$HUB_PORT"     # e.g. 14523

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GSD2_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="${GSD_PROJECT_DIR:-$(dirname "$GSD2_DIR")}"

# Deterministic 4-char hash from project path
if command -v md5 >/dev/null 2>&1; then
  GSD_PROJECT_HASH=$(printf '%s' "$PROJECT_DIR" | md5 -q | cut -c1-4)
elif command -v md5sum >/dev/null 2>&1; then
  GSD_PROJECT_HASH=$(printf '%s' "$PROJECT_DIR" | md5sum | cut -c1-4)
else
  GSD_PROJECT_HASH=$(printf '%s' "$PROJECT_DIR" | cksum | cut -d' ' -f1 | cut -c1-4)
fi

# Deterministic port: 10000 + (hash % 55535) → range [10000, 65535]
HUB_PORT="${GSD_HUB_PORT:-$(python3 -c "print(10000 + int('${GSD_PROJECT_HASH}', 16) % 55535)" 2>/dev/null || echo 8765)}"

TMUX_PREFIX="g-${GSD_PROJECT_HASH}"
HUB_CALL="$SCRIPT_DIR/hub-call.sh"
CURSOR_BIN=""
PROMPT_DIR="/tmp/gsd2-${GSD_PROJECT_HASH}-prompts"

# Detect Cursor CLI
for p in \
  /Applications/Cursor.app/Contents/Resources/app/bin/cursor \
  "$HOME/.local/bin/cursor" \
  /usr/local/bin/cursor \
  "$(command -v cursor 2>/dev/null || true)"; do
  [ -n "$p" ] && [ -x "$p" ] && { CURSOR_BIN="$p"; break; }
done

# Export for child processes (hub-call.sh reads GSD_HUB_PORT)
export GSD_HUB_PORT="$HUB_PORT"
export GSD_PROJECT_HASH
export GSD_PROJECT_DIR="$PROJECT_DIR"

# Convenience: check if Hub is reachable
hub_alive() {
  curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lib","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'
}

# Convenience: count sessions matching our prefix
our_sessions() {
  tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | wc -l | tr -d ' '
}

# Convenience: kill all our sessions except hub
kill_our_agents() {
  for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | grep -v "^${TMUX_PREFIX}-hub$" || true); do
    tmux kill-session -t "$s" 2>/dev/null || true
  done
}
