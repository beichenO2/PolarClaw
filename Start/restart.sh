#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$SCRIPT_DIR/stop.sh"
sleep 1
exec bash "$SCRIPT_DIR/start.sh" "$@"
