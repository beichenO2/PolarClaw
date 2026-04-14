#!/bin/bash
# deploy-and-restart.sh — 一键部署 v0.5.1 修复到所有项目并逐个重启
#
# 用法:
#   bash deploy-and-restart.sh              # 同步 + 重启全部项目
#   bash deploy-and-restart.sh --sync-only  # 只同步代码，不重启
#   bash deploy-and-restart.sh --restart-only  # 只重启（已经同步过）
#   bash deploy-and-restart.sh --model claude-sonnet-4  # 指定模型
#
# 前置条件：
#   1. Cursor 账单已付清
#   2. 所有项目的 tmux sessions 已停止
#   3. 系统负载已恢复正常（< 10）

set -euo pipefail

# ===== 配置 =====
GSD2_SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/GetShitDone/gsd-2"
AGENT_MODEL="claude-4.6-opus-max-thinking"
DO_SYNC=true
DO_RESTART=true
WORKERS_PER_PROJECT=3
RESTART_INTERVAL=30

PROJECTS=(
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/Clock"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/信息管理"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/MyClaw"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/digist"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/AutoOffice"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/LLM Wiki"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Tools/KnowLever"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/tqsdk/刺客八号 期货量化"
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/tqsdk/trading-platform"
)

# ===== 参数解析 =====
for arg in "$@"; do
  case "$arg" in
    --sync-only) DO_RESTART=false ;;
    --restart-only) DO_SYNC=false ;;
    --model) ;;
    *) ;;
  esac
done
for i in $(seq 1 $(($# - 1))); do
  arg="${!i}"
  next_i=$((i + 1))
  next_arg="${!next_i:-}"
  [ "$arg" = "--model" ] && [ -n "$next_arg" ] && AGENT_MODEL="$next_arg"
done

echo "╔══════════════════════════════════════════════╗"
echo "║   gsd-2 v0.5.1 部署与重启                   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "源码:    $GSD2_SRC"
echo "模型:    $AGENT_MODEL"
echo "项目数:  ${#PROJECTS[@]}"
echo "同步:    $DO_SYNC"
echo "重启:    $DO_RESTART"
echo ""

# ===== 前置检查 =====
echo "=== 前置检查 ==="

LOAD=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || uptime | awk -F'load averages:' '{print $2}' | awk '{print $1}')
echo "系统负载: $LOAD"

EXISTING_SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^g-' | wc -l | tr -d ' ' || echo 0)
if [ "$EXISTING_SESSIONS" -gt 0 ]; then
  echo "⚠️  仍有 $EXISTING_SESSIONS 个 g-* sessions 运行中"
  echo "   先运行: tmux list-sessions -F '#{session_name}' | grep '^g-' | xargs -I{} tmux kill-session -t {}"
  echo "   然后重新运行本脚本"
  exit 1
fi
echo "✓ 无残留 sessions"

if ! command -v cursor &>/dev/null; then
  CURSOR_BIN=$(find /usr/local/bin /opt/homebrew/bin "$HOME/.cursor" /Applications -name "cursor" -type f 2>/dev/null | head -1)
  if [ -z "$CURSOR_BIN" ]; then
    echo "✗ 找不到 Cursor CLI"
    exit 1
  fi
else
  CURSOR_BIN="cursor"
fi
echo "✓ Cursor CLI: $CURSOR_BIN"

if [ ! -d "$GSD2_SRC" ]; then
  echo "✗ 源码目录不存在: $GSD2_SRC"
  exit 1
fi
SRC_VERSION=$(python3 -c "import json; print(json.load(open('$GSD2_SRC/package.json'))['version'])" 2>/dev/null)
echo "✓ 源码版本: v$SRC_VERSION"
echo ""

# ===== 第 1 步：同步代码 =====
if $DO_SYNC; then
  echo "=== 同步 v$SRC_VERSION 到所有项目 ==="
  SYNCED=0
  for proj in "${PROJECTS[@]}"; do
    target="$proj/gsd-2"
    if [ -d "$target" ] || [ -L "$target" ]; then
      # 如果是符号链接，跳过
      if [ -L "$target" ]; then
        echo "  ⊘ $(basename "$proj")/gsd-2 — 已是符号链接，跳过"
        continue
      fi
      echo -n "  → $(basename "$proj")/gsd-2 ... "
      rsync -a --delete \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '.planning' \
        --exclude 'dist' \
        "$GSD2_SRC/" "$target/"
      # 确保 node_modules 存在
      if [ ! -d "$target/node_modules" ]; then
        echo -n "(npm install) "
        cd "$target" && npm install --silent 2>/dev/null
      fi
      SYNCED=$((SYNCED + 1))
      NEW_VER=$(python3 -c "import json; print(json.load(open('$target/package.json'))['version'])" 2>/dev/null)
      echo "v$NEW_VER ✓"
    else
      echo "  ⊘ $(basename "$proj") — 无 gsd-2 目录，跳过"
    fi
  done
  echo "同步完成: $SYNCED 个项目"
  echo ""
fi

# ===== 第 2 步：逐个重启 =====
if $DO_RESTART; then
  echo "=== 逐个重启项目（每个间隔 ${RESTART_INTERVAL}s）==="
  STARTED=0
  for proj in "${PROJECTS[@]}"; do
    gsd2_dir="$proj/gsd-2"
    launch_script="$gsd2_dir/scripts/launch-cluster.sh"

    if [ ! -f "$launch_script" ]; then
      echo "  ⊘ $(basename "$proj") — 无 launch-cluster.sh，跳过"
      continue
    fi

    echo ""
    echo "--- [$(( STARTED + 1 ))/${#PROJECTS[@]}] $(basename "$proj") ---"

    export GSD_PROJECT_DIR="$proj"
    export CURSOR_BIN="$CURSOR_BIN"
    bash "$launch_script" "$WORKERS_PER_PROJECT" --model "$AGENT_MODEL" 2>&1 | sed 's/^/  /'

    STARTED=$((STARTED + 1))

    # 验证是否正常启动
    sleep 5
    LOAD_NOW=$(uptime | awk -F'load averages:' '{print $2}' | awk '{print $1}' | tr -d ' ')
    echo "  负载: $LOAD_NOW"

    if [ $STARTED -lt ${#PROJECTS[@]} ]; then
      echo "  等待 ${RESTART_INTERVAL}s 后启动下一个项目..."
      sleep "$RESTART_INTERVAL"
    fi
  done

  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║   部署完成                                   ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "已启动项目: $STARTED"
  echo "总 sessions: $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^g-' | wc -l | tr -d ' ')"
  echo ""
  echo "监控命令:"
  echo "  tmux list-sessions | grep '^g-'          # 查看所有 sessions"
  echo "  uptime                                    # 查看系统负载"
  echo "  tmux attach -t <session-name>             # 查看具体 agent"
  echo ""
  echo "如果某个项目有问题，单独停止:"
  echo "  GSD_PROJECT_DIR='<项目路径>' bash <gsd-2>/scripts/stop-cluster.sh"
fi
