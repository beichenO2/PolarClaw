#!/bin/bash
# test-e2e-cluster.sh — End-to-end cluster communication test
#
# Tests the full proxy→controller→worker→supervisor pipeline without
# starting actual cursor agents. Uses hub-call.sh directly.
#
# Usage:
#   ./test-e2e-cluster.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"
PASS=0
FAIL=0

check() {
  local DESC="$1"
  local RESULT="$2"
  if echo "$RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);assert d.get('ok',False) or d.get('task') is not None or d.get('tasks') is not None or d.get('roles') is not None" 2>/dev/null; then
    echo "  ✓ $DESC"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $DESC"
    echo "    $RESULT" | head -c 200
    echo ""
    FAIL=$((FAIL + 1))
  fi
}

echo "=== gsd-2 端到端集群测试 ==="
echo ""

# Verify Hub is running
if ! curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"e2e","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then
  echo "ERROR: Hub not running on port $HUB_PORT"
  exit 1
fi

# Clean session files for test agents
rm -f /tmp/gsd2-session-e2e-*

echo "▸ 注册"
R=$(  "$HUB_CALL" e2e-proxy   hub_register '{"agent_id":"e2e-proxy"}'   2>/dev/null); check "proxy 注册" "$R"
R=$(  "$HUB_CALL" e2e-ctrl    hub_register '{"agent_id":"e2e-ctrl"}'    2>/dev/null); check "ctrl 注册" "$R"
R=$(  "$HUB_CALL" e2e-worker  hub_register '{"agent_id":"e2e-worker"}'  2>/dev/null); check "worker 注册" "$R"
R=$(  "$HUB_CALL" e2e-super   hub_register '{"agent_id":"e2e-super"}'   2>/dev/null); check "super 注册" "$R"

echo ""
echo "▸ 角色分配"
R=$("$HUB_CALL" e2e-proxy hub_assign_role '{"agent_id":"e2e-proxy","role":"proxy"}'     2>/dev/null); check "proxy 角色" "$R"
R=$("$HUB_CALL" e2e-proxy hub_assign_role '{"agent_id":"e2e-ctrl","role":"controller"}' 2>/dev/null); check "ctrl 角色" "$R"
R=$("$HUB_CALL" e2e-proxy hub_assign_role '{"agent_id":"e2e-worker","role":"worker"}'   2>/dev/null); check "worker 角色" "$R"
R=$("$HUB_CALL" e2e-proxy hub_assign_role '{"agent_id":"e2e-super","role":"supervisor"}'2>/dev/null); check "super 角色" "$R"

echo ""
echo "▸ 消息传递"
R=$("$HUB_CALL" e2e-proxy hub_publish '{"agent_id":"e2e-proxy","topic":"e2e-ctrl.inbox","payload":{"type":"phase_objective","goal":"test"}}' 2>/dev/null); check "proxy→ctrl 发送" "$R"
R=$("$HUB_CALL" e2e-ctrl hub_poll_events '{"agent_id":"e2e-ctrl"}' 2>/dev/null); check "ctrl 轮询事件" "$R"

echo ""
echo "▸ 任务流程"
R=$("$HUB_CALL" e2e-ctrl hub_create_task '{"creator_agent_id":"e2e-ctrl","title":"E2E test task","workflow_stage":"execute","priority":100}' 2>/dev/null); check "ctrl 创建任务" "$R"
TASK_ID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['task']['id'])" 2>/dev/null || echo "unknown")

R=$("$HUB_CALL" e2e-worker hub_claim_task '{"agent_id":"e2e-worker"}' 2>/dev/null); check "worker 领取任务" "$R"
CLAIMED_ID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);t=d.get('task');print(t['id'] if t else 'null')" 2>/dev/null || echo "null")

if [ "$CLAIMED_ID" != "null" ] && [ -n "$CLAIMED_ID" ]; then
  R=$("$HUB_CALL" e2e-worker hub_complete_task "{\"agent_id\":\"e2e-worker\",\"task_id\":\"$CLAIMED_ID\",\"result_summary\":\"E2E test passed\"}" 2>/dev/null); check "worker 完成任务" "$R"
else
  echo "  ⚠ 跳过完成任务（未领到）"
fi

R=$("$HUB_CALL" e2e-proxy hub_list_tasks '{}' 2>/dev/null); check "列出任务" "$R"

echo ""
echo "▸ 监控"
R=$("$HUB_CALL" e2e-proxy hub_get_health '{}' 2>/dev/null); check "健康检查" "$R"
R=$("$HUB_CALL" e2e-proxy hub_get_progress '{}' 2>/dev/null); check "进度查询" "$R"
R=$("$HUB_CALL" e2e-proxy hub_get_roles '{}' 2>/dev/null); check "角色查询" "$R"

# Cleanup
rm -f /tmp/gsd2-session-e2e-*

echo ""
echo "═══════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════"

[ $FAIL -eq 0 ] && exit 0 || exit 1
