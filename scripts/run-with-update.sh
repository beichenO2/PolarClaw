#!/usr/bin/env bash
# MyClaw — run with auto-update check
# Used by launchd (com.myclaw.agent.plist)
#
# Flow:
#   1. git fetch origin main
#   2. If local != remote → git pull + npm install
#   3. Start node start.mjs
#
# launchd KeepAlive ensures if node crashes, this script re-runs.
# ThrottleInterval=30 prevents restart loops.

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
LOG_PREFIX="[run-with-update]"

# Use the Node version that native modules were compiled against.
# .nvmrc or NODE_VERSION pin takes precedence, else default to v20.
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -f "$PROJECT_ROOT/.nvmrc" ]; then
  WANTED="$(cat "$PROJECT_ROOT/.nvmrc" | tr -d '[:space:]')"
elif [ -n "${NODE_VERSION:-}" ]; then
  WANTED="$NODE_VERSION"
else
  WANTED="v20"
fi
NVM_NODE="$(ls -d "$NVM_DIR/versions/node/${WANTED}"* 2>/dev/null | sort -V | tail -1)"
if [ -n "$NVM_NODE" ] && [ -x "$NVM_NODE/bin/node" ]; then
  export PATH="$NVM_NODE/bin:$PATH"
fi

log() { echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# --- Auto-update check ---
check_and_update() {
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    log "Not a git repo, skipping update check"
    return 0
  fi

  git fetch origin main --quiet 2>/dev/null || {
    log "git fetch failed (network?), starting with current version"
    return 0
  }

  local LOCAL REMOTE
  LOCAL="$(git rev-parse HEAD 2>/dev/null || echo '')"
  REMOTE="$(git rev-parse origin/main 2>/dev/null || echo '')"

  if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
    log "Cannot determine git versions, starting with current"
    return 0
  fi

  if [ "$LOCAL" = "$REMOTE" ]; then
    log "Already up to date (${LOCAL:0:7})"
    return 0
  fi

  log "Update available: ${LOCAL:0:7} → ${REMOTE:0:7}"

  if ! git diff --quiet HEAD 2>/dev/null; then
    log "Local changes detected, skipping auto-pull"
    return 0
  fi

  git pull origin main --quiet 2>/dev/null || {
    log "git pull failed, starting with current version"
    return 0
  }

  if [ -f package.json ]; then
    log "Running npm install..."
    npm install --silent 2>/dev/null || log "npm install failed (non-fatal)"
  fi

  log "Updated to $(git rev-parse --short HEAD)"
}

# --- Main ---
log "Starting MyClaw (pid $$)"
check_and_update

exec node start.mjs
