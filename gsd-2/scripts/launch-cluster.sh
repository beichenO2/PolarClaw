#!/bin/bash
# launch-cluster.sh — Start the complete gsd-2 multi-agent cluster
#
# Usage:
#   ./launch-cluster.sh [NUM_WORKERS]                (default: 5)
#   ./launch-cluster.sh 10                           (10 workers)
#   ./launch-cluster.sh 10 --watchdog                (with Hub watchdog)
#   ./launch-cluster.sh 150 --watchdog --batch 20    (200-agent mode)
#   ./launch-cluster.sh 30 --tiered                  (3-tier: 5 partition ctrls + workers)
#
# All sessions use project-isolated prefix (g-<hash>-) and deterministic port.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

# 全局锁检查: 如果已锁定则拒绝启动
if "$SCRIPT_DIR/global-lock.sh" check 2>/dev/null; then
  echo "ERROR: 全局资源已锁定，不允许启动新集群"
  echo "       运行 $SCRIPT_DIR/global-lock.sh status 查看状态"
  echo "       运行 $SCRIPT_DIR/global-lock.sh unlock --force 紧急解锁"
  exit 1
fi

NUM_WORKERS="${1:-5}"
ENABLE_WATCHDOG=false
ENABLE_TIERED=false
BATCH_SIZE=20
BATCH_DELAY=5
AGENT_MODEL="auto"

for arg in "$@"; do
  case "$arg" in
    --watchdog) ENABLE_WATCHDOG=true ;;
    --tiered) ENABLE_TIERED=true ;;
    --batch) ;;
    --model) ;;
  esac
done
# Parse --batch N and --model <id>
if [ $# -ge 2 ]; then
  for i in $(seq 1 $(($# - 1))); do
    arg="${!i}"
    next_i=$((i + 1))
    next_arg="${!next_i:-}"
    [ "$arg" = "--batch" ] && [ -n "$next_arg" ] && BATCH_SIZE="$next_arg"
    [ "$arg" = "--model" ] && [ -n "$next_arg" ] && AGENT_MODEL="$next_arg"
  done
fi
[[ "$NUM_WORKERS" == --* ]] && NUM_WORKERS=5

# 构造模型参数标志 — 始终显式传递 --model
# auto 模式下，调用者应在 --model 中传入代理自身检测到的模型ID
# 即 auto 意味着"继承代理的模型"，不是"不指定模型"
if [ "$AGENT_MODEL" = "auto" ]; then
  echo "WARNING: --model 为 auto，应由代理解析为具体模型ID后再启动集群"
  echo "         请在 mode.json 中设置 resolved_model 字段"
fi
MODEL_FLAG="--model $AGENT_MODEL"

echo "╔══════════════════════════════════════════╗"
echo "║       gsd-2 集群启动 v0.5.1             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "项目:     $PROJECT_DIR"
echo "隔离ID:   $GSD_PROJECT_HASH"
echo "前缀:     $TMUX_PREFIX"
echo "端口:     $HUB_PORT"
echo "工人数:   $NUM_WORKERS"
echo "模型:     $AGENT_MODEL"
echo "批大小:   $BATCH_SIZE"
echo ""

if [ -z "$CURSOR_BIN" ]; then
  echo "ERROR: Cursor CLI not found"
  exit 1
fi

# --- Start Hub if not running ---
if ! curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"check","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then

  for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-hub$" || true); do
    tmux kill-session -t "$s" 2>/dev/null || true
  done

  mkdir -p "$PROJECT_DIR/.planning/hub" "$PROJECT_DIR/.planning/logs"
  tmux new-session -d -s "${TMUX_PREFIX}-hub" -x 200 -y 50
  tmux send-keys -t "${TMUX_PREFIX}-hub" "conda deactivate 2>/dev/null; export PATH=/opt/homebrew/bin:\$PATH; cd '$GSD2_DIR' && GSD_HUB_PORT=$HUB_PORT GSD_HUB_DB='$PROJECT_DIR/.planning/hub/hub.sqlite' npm run start 2>&1 | tee '$PROJECT_DIR/.planning/logs/hub.log'" Enter

  echo -n "等待 Hub..."
  for i in $(seq 1 15); do
    if curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"check","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then
      echo " OK (${i}s)"
      break
    fi
    sleep 1
  done
else
  echo "Hub 已在端口 $HUB_PORT 运行"
fi

# --- Create prompt files ---
mkdir -p "$PROMPT_DIR"

# Launcher script — single-shot execution, no restart loop.
# The agent runs once and stays alive by continuously calling Shell tools internally.
# When it dies (context window exhausted), the tmux session ends. No restart.
cat > "$PROMPT_DIR/launcher.sh" << 'LAUNCHER_EOF'
#!/bin/bash
AGENT_NAME="$1"
PROMPT_DIR_L="PROMPT_DIR_PLACEHOLDER"
PROMPT_FILE="${PROMPT_DIR_L}/${AGENT_NAME}.prompt"
PROJECT_DIR_L="PROJECT_DIR_PLACEHOLDER"
CURSOR_BIN_L="CURSOR_BIN_PLACEHOLDER"
export GSD_HUB_PORT=HUB_PORT_PLACEHOLDER
export GSD_PROJECT_HASH=HASH_PLACEHOLDER
export GSD_AGENT_MODEL="MODEL_PLACEHOLDER"

cd "$PROJECT_DIR_L" || exit 1
[ ! -f "$PROMPT_FILE" ] && echo "[${AGENT_NAME}] ERROR: no prompt file: $PROMPT_FILE" && exit 1

PROMPT=$(cat "$PROMPT_FILE")
echo "=== [${AGENT_NAME}] 启动 $(date) — model:${GSD_AGENT_MODEL} — 单次执行，不重启 ==="
"$CURSOR_BIN_L" agent --print --yolo --model "$GSD_AGENT_MODEL" "$PROMPT" 2>&1
EXIT_CODE=$?
echo "=== [${AGENT_NAME}] 死亡 $(date) — exit:${EXIT_CODE} — tmux session 结束 ==="
LAUNCHER_EOF
# Replace placeholders with actual values (avoids heredoc quoting issues)
sed -i '' \
  -e "s|PROMPT_DIR_PLACEHOLDER|$PROMPT_DIR|g" \
  -e "s|PROJECT_DIR_PLACEHOLDER|$PROJECT_DIR|g" \
  -e "s|CURSOR_BIN_PLACEHOLDER|$CURSOR_BIN|g" \
  -e "s|HUB_PORT_PLACEHOLDER|$HUB_PORT|g" \
  -e "s|HASH_PLACEHOLDER|$GSD_PROJECT_HASH|g" \
  -e "s|MODEL_PLACEHOLDER|$AGENT_MODEL|g" \
  "$PROMPT_DIR/launcher.sh"
chmod +x "$PROMPT_DIR/launcher.sh"

# Generate prompts from templates
ROLES_DIR="$GSD2_DIR/src/roles"

generate_prompt() {
  local TEMPLATE="$1" AGENT_ID="$2" OUTPUT="$3"
  if [ -f "$TEMPLATE" ]; then
    sed -e "s|{{AGENT_ID}}|$AGENT_ID|g" -e "s|{{HUB_CALL}}|$HUB_CALL|g" "$TEMPLATE" > "$OUTPUT"
  else
    echo "你是 $AGENT_ID。用Shell执行 \"$HUB_CALL\" $AGENT_ID hub_register '{\"agent_id\":\"$AGENT_ID\"}'。然后执行角色任务。" > "$OUTPUT"
  fi
}

generate_prompt "$ROLES_DIR/controller-prompt.template.md" "ctrl" "$PROMPT_DIR/ctrl.prompt"
generate_prompt "$ROLES_DIR/supervisor-prompt.template.md" "super" "$PROMPT_DIR/super.prompt"

for i in $(seq 1 "$NUM_WORKERS"); do
  WNAME=$(printf "w%03d" "$i")
  generate_prompt "$ROLES_DIR/worker-prompt.template.md" "$WNAME" "$PROMPT_DIR/$WNAME.prompt"
done

echo "Prompt 文件: $(ls "$PROMPT_DIR"/*.prompt 2>/dev/null | wc -l | tr -d ' ') 个"

# --- Kill old agent sessions (only our prefix, keep hub) ---
for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | grep -v "^${TMUX_PREFIX}-hub$" || true); do
  tmux kill-session -t "$s" 2>/dev/null || true
done

# --- Clean old session files ---
rm -f /tmp/gsd2-session-*

# --- Launch agents ---
tmux new-session -d -s "${TMUX_PREFIX}-ctrl" -x 200 -y 50 "bash $PROMPT_DIR/launcher.sh ctrl"
tmux new-session -d -s "${TMUX_PREFIX}-super" -x 200 -y 50 "bash $PROMPT_DIR/launcher.sh super"

LAUNCHED=0
for i in $(seq 1 "$NUM_WORKERS"); do
  WNAME=$(printf "w%03d" "$i")
  tmux new-session -d -s "${TMUX_PREFIX}-${WNAME}" -x 200 -y 50 "bash $PROMPT_DIR/launcher.sh $WNAME"
  LAUNCHED=$((LAUNCHED + 1))

  if [ $((LAUNCHED % BATCH_SIZE)) -eq 0 ] && [ $LAUNCHED -lt $NUM_WORKERS ]; then
    echo "  批次 $((LAUNCHED / BATCH_SIZE)) 完成 ($LAUNCHED/$NUM_WORKERS)，等待 ${BATCH_DELAY}s..."
    sleep "$BATCH_DELAY"
  fi
done

echo "Worker sessions: $LAUNCHED 个已启动"

# --- Launch standby (reserve pool) agents ---
NUM_STANDBY=$((NUM_WORKERS / 5))
[ $NUM_STANDBY -lt 2 ] && NUM_STANDBY=2
[ $NUM_STANDBY -gt 10 ] && NUM_STANDBY=10

STANDBY_TEMPLATE="$ROLES_DIR/standby-prompt.template.md"
for i in $(seq 1 "$NUM_STANDBY"); do
  SNAME=$(printf "sb%02d" "$i")
  if [ -f "$STANDBY_TEMPLATE" ]; then
    sed -e "s|{{AGENT_ID}}|$SNAME|g" -e "s|{{HUB_CALL}}|$HUB_CALL|g" "$STANDBY_TEMPLATE" > "$PROMPT_DIR/$SNAME.prompt"
  else
    cat > "$PROMPT_DIR/$SNAME.prompt" << SBEOF
# Role: STANDBY (待命)

你是 $SNAME，备用池中的待命 Agent。

## 生命周期规则
- 你是常驻服务，绝不退出
- 持续轮询等待角色分配

## 工作流程
1. 注册: bash $HUB_CALL $SNAME hub_register '{"agent_id":"$SNAME"}'
2. 循环轮询:
   - bash $HUB_CALL $SNAME hub_poll_events '{}'
   - bash $HUB_CALL $SNAME hub_heartbeat_role '{}'
   - sleep 15
3. 收到角色分配消息后立即执行新角色
SBEOF
  fi
  tmux new-session -d -s "${TMUX_PREFIX}-${SNAME}" -x 200 -y 50 "bash $PROMPT_DIR/launcher.sh $SNAME"
done

echo "Standby agents: $NUM_STANDBY 个已启动 (备用池)"

# --- Tiered: launch partition controllers ---
PARTITIONS=(backend frontend data infra test)
PARTITION_SHORT=(be fe data infra test)

if $ENABLE_TIERED; then
  PART_TEMPLATE="$ROLES_DIR/partition-ctrl-prompt.template.md"
  for idx in $(seq 0 $((${#PARTITIONS[@]} - 1))); do
    PART="${PARTITIONS[$idx]}"
    SHORT="${PARTITION_SHORT[$idx]}"
    AGENT_ID="ctrl-$SHORT"

    if [ -f "$PART_TEMPLATE" ]; then
      sed -e "s|{{AGENT_ID}}|$AGENT_ID|g" -e "s|{{HUB_CALL}}|$HUB_CALL|g" -e "s|{{PARTITION}}|$PART|g" \
        "$PART_TEMPLATE" > "$PROMPT_DIR/$AGENT_ID.prompt"
    else
      echo "你是 $AGENT_ID 分区控制器($PART)。用Shell执行 \"$HUB_CALL\" $AGENT_ID hub_register '{\"agent_id\":\"$AGENT_ID\"}'。" > "$PROMPT_DIR/$AGENT_ID.prompt"
    fi

    tmux new-session -d -s "${TMUX_PREFIX}-${AGENT_ID}" -x 200 -y 50 "bash $PROMPT_DIR/launcher.sh $AGENT_ID"
  done
  echo "分区控制器: ${#PARTITIONS[@]} 个已启动 (${PARTITIONS[*]})"
fi

TIER_COUNT=0
$ENABLE_TIERED && TIER_COUNT=${#PARTITIONS[@]}
echo "总 Agent: $((LAUNCHED + 2 + NUM_STANDBY + TIER_COUNT)) 个"

# --- Assign roles ---
sleep 2
"$HUB_CALL" proxy hub_register '{"agent_id":"proxy"}' > /dev/null 2>&1 || true
"$HUB_CALL" proxy hub_assign_role '{"agent_id":"proxy","role":"proxy"}' > /dev/null 2>&1 || true
"$HUB_CALL" proxy hub_assign_role '{"agent_id":"ctrl","role":"controller"}' > /dev/null 2>&1 || true
"$HUB_CALL" proxy hub_assign_role '{"agent_id":"super","role":"supervisor"}' > /dev/null 2>&1 || true

for i in $(seq 1 "$NUM_WORKERS"); do
  WNAME=$(printf "w%03d" "$i")
  "$HUB_CALL" proxy hub_assign_role "{\"agent_id\":\"$WNAME\",\"role\":\"worker\"}" > /dev/null 2>&1 || true
done

for i in $(seq 1 "$NUM_STANDBY"); do
  SNAME=$(printf "sb%02d" "$i")
  "$HUB_CALL" proxy hub_assign_role "{\"agent_id\":\"$SNAME\",\"role\":\"reserve\"}" > /dev/null 2>&1 || true
done

if $ENABLE_TIERED; then
  for idx in $(seq 0 $((${#PARTITION_SHORT[@]} - 1))); do
    SHORT="${PARTITION_SHORT[$idx]}"
    "$HUB_CALL" proxy hub_assign_role "{\"agent_id\":\"ctrl-$SHORT\",\"role\":\"controller\"}" > /dev/null 2>&1 || true
  done
fi

echo "角色已分配 (含 $NUM_STANDBY 个备用)"

# --- Watchdog ---
if $ENABLE_WATCHDOG; then
  tmux new-session -d -s "${TMUX_PREFIX}-watchdog" -x 200 -y 50 "GSD_HUB_PORT=$HUB_PORT GSD_PROJECT_DIR='$PROJECT_DIR' bash $SCRIPT_DIR/hub-watchdog.sh --interval 10"
  echo "Hub watchdog 已启动"
fi

# --- Summary ---
TOTAL_SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | wc -l | tr -d ' ')
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       集群就绪                           ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Sessions:  $TOTAL_SESSIONS"
echo "Hub:       http://127.0.0.1:$HUB_PORT/mcp"
echo "前缀:      $TMUX_PREFIX"
echo "模型:      $AGENT_MODEL"
echo "角色:      proxy + ctrl + super + $NUM_WORKERS workers + $NUM_STANDBY standby"
echo ""
echo "监控: GSD_PROJECT_DIR='$PROJECT_DIR' $SCRIPT_DIR/cluster-status.sh"
echo "停止: GSD_PROJECT_DIR='$PROJECT_DIR' $SCRIPT_DIR/stop-cluster.sh"
