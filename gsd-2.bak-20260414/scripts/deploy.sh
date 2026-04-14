#!/bin/bash
#
# gsd-2 通用部署脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/gsd-build/gsd-2/main/scripts/deploy.sh | bash -s -- <项目目录>
#   或:
#   ./deploy.sh <项目目录>
#
# 做四件事:
#   1. clone / 更新 gsd-2 到项目目录
#   2. 安装依赖
#   3. 启动 Hub
#   4. 生成带正确路径的代理 Prompt 并输出启动指引
#
# 环境变量:
#   GSD_HUB_PORT   Hub 端口 (默认 8765)
#   CURSOR_BIN     Cursor CLI 路径 (自动检测)
#   GSD2_REPO      Git 仓库地址 (默认 gsd-build/gsd-2)

set -euo pipefail

PROJECT_DIR="${1:?用法: ./deploy.sh <项目目录>}"

# 获取绝对路径（目录可能还不存在）
mkdir -p "$PROJECT_DIR"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

GSD2_REPO="${GSD2_REPO:-https://github.com/beichenO2/gsd-2.git}"
GSD2_DIR="${PROJECT_DIR}/gsd-2"
HUB_PORT="${GSD_HUB_PORT:-8765}"
HUB_URL="http://127.0.0.1:${HUB_PORT}/mcp"

# ─── 自动检测 Cursor CLI ────────────────────────────
detect_cursor() {
  # 常见路径
  local candidates=(
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
    "$HOME/.local/bin/cursor"
    "/usr/local/bin/cursor"
    "$(command -v cursor 2>/dev/null || true)"
  )
  for c in "${candidates[@]}"; do
    if [ -n "$c" ] && [ -x "$c" ]; then
      echo "$c"
      return
    fi
  done
  echo ""
}

CURSOR_BIN="${CURSOR_BIN:-$(detect_cursor)}"

# ─── 打印头 ─────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │         gsd-2 多Agent系统 部署           │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ─── 检查依赖 ───────────────────────────────────────
echo "  [检查] 验证依赖..."
fail=0
for cmd in node npm tmux git; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  ✗ 缺少 $cmd"
    fail=1
  fi
done

NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ "${NODE_VER:-0}" -lt 22 ]; then
  echo "  ✗ Node.js 版本太低 ($(node -v 2>/dev/null || echo '未安装')), 需要 22+"
  fail=1
fi

if [ -z "$CURSOR_BIN" ]; then
  echo "  ✗ 找不到 Cursor CLI"
  echo "    设置 CURSOR_BIN 环境变量，或确认 Cursor 已安装"
  fail=1
else
  echo "  ✓ Cursor CLI: $CURSOR_BIN"
fi

[ "$fail" -eq 1 ] && exit 1
echo "  ✓ 所有依赖就绪"
echo ""

# ─── Clone / 更新 gsd-2 ─────────────────────────────
echo "  [安装] gsd-2..."

if [ -d "$GSD2_DIR" ]; then
  # 已存在，检查是否需要更新
  if [ -d "$GSD2_DIR/.git" ]; then
    cd "$GSD2_DIR"
    LOCAL_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

    # fetch 最新
    git fetch origin main --quiet 2>/dev/null || true
    REMOTE_VER=$(git show origin/main:package.json 2>/dev/null | node -e "
      let d='';process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{try{console.log(JSON.parse(d).version)}catch{console.log('unknown')}})
    " 2>/dev/null || echo "unknown")

    if [ "$LOCAL_VER" = "$REMOTE_VER" ] && [ "$LOCAL_VER" != "unknown" ]; then
      echo "  ✓ gsd-2 已是最新版本 (v${LOCAL_VER})"
    else
      echo "  ↑ 发现新版本: 本地 v${LOCAL_VER} → 远程 v${REMOTE_VER}"
      echo "    正在更新（覆盖安装，以 GitHub 版本为准）..."
      git reset --hard origin/main --quiet
      echo "  ✓ 已更新到 v${REMOTE_VER}"
    fi
    cd "$PROJECT_DIR"
  else
    # 有 gsd-2 目录但不是 git repo — 备份后重新 clone
    echo "  ⚠ 发现非 git 版本的 gsd-2，备份后重新安装..."
    mv "$GSD2_DIR" "${GSD2_DIR}.bak.$(date +%s)"
    git clone --depth 1 "$GSD2_REPO" "$GSD2_DIR" --quiet
    echo "  ✓ 重新安装完成（旧版已备份）"
  fi
else
  # 全新安装
  git clone --depth 1 "$GSD2_REPO" "$GSD2_DIR" --quiet
  LOCAL_VER=$(node -e "console.log(require('$GSD2_DIR/package.json').version)" 2>/dev/null || echo "?")
  echo "  ✓ 已安装 gsd-2 v${LOCAL_VER}"
fi

# ─── npm install ─────────────────────────────────────
if [ ! -d "$GSD2_DIR/node_modules" ]; then
  echo "  [依赖] npm install..."
  (cd "$GSD2_DIR" && npm install --silent 2>&1 | tail -1)
fi
echo "  ✓ npm 依赖就绪"
echo ""

# ─── 清理旧 session ─────────────────────────────────
echo "  [清理] 旧的 gsd2 session..."
for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^gsd2-' || true); do
  tmux kill-session -t "$s" 2>/dev/null || true
done
rm -f /tmp/gsd2-session-*

# ─── 创建目录结构 ────────────────────────────────────
LOG_DIR="${PROJECT_DIR}/.planning/logs"
mkdir -p "$LOG_DIR"
mkdir -p "${PROJECT_DIR}/.planning/hub"
mkdir -p "${PROJECT_DIR}/.planning/reports"/{proxy,controller,supervisor,clk,workers}

# ─── 启动 Hub ────────────────────────────────────────
echo "  [启动] MCP Hub (端口 ${HUB_PORT})..."
tmux new-session -d -s gsd2-hub -x 200 -y 50
tmux send-keys -t gsd2-hub "cd '${GSD2_DIR}' && GSD_HUB_PORT=${HUB_PORT} GSD_HUB_DB='${PROJECT_DIR}/.planning/hub/hub.sqlite' npm run start 2>&1 | tee '${LOG_DIR}/hub.log'" Enter

for i in $(seq 1 15); do
  sleep 1
  if curl -s "${HUB_URL}" -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"deploy","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then
    echo "  ✓ Hub 已启动"
    break
  fi
  [ "$i" -eq 15 ] && { echo "  ✗ Hub 启动超时，检查: tail -f ${LOG_DIR}/hub.log"; exit 1; }
done
echo ""

# ─── 生成代理 Prompt ─────────────────────────────────
echo "  [生成] 代理 Prompt..."

# 调用内置的 prompt 生成器
PROMPT_FILE="${PROJECT_DIR}/.planning/proxy-system-prompt.md"
node -e "
const path = require('path');
const fs = require('fs');
const tpl = fs.readFileSync(path.join('${GSD2_DIR}', 'src', 'roles', 'proxy-prompt.template.md'), 'utf8');
const out = tpl
  .replace(/\\\$\{PROJECT_DIR\}/g, '${PROJECT_DIR}')
  .replace(/\\\$\{GSD2_DIR\}/g, '${GSD2_DIR}')
  .replace(/\\\$\{HUB_PORT\}/g, '${HUB_PORT}')
  .replace(/\\\$\{CURSOR_BIN\}/g, '${CURSOR_BIN}');
fs.writeFileSync('${PROMPT_FILE}', out);
" 2>/dev/null || {
  # fallback: 直接从 deploy.sh 生成
  cat > "$PROMPT_FILE" << PROMPT_EOF
阅读 ${GSD2_DIR}/src/roles/proxy-prompt.template.md 获取完整指令。

环境变量:
- HUB_CALL="${GSD2_DIR}/scripts/hub-call.sh"
- CURSOR_CLI="${CURSOR_BIN}"
- PROJECT_DIR="${PROJECT_DIR}"
- HUB_PORT=${HUB_PORT}
- Hub URL: http://127.0.0.1:${HUB_PORT}/mcp

按模板里的阶段1-5执行。
PROMPT_EOF
}

echo "  ✓ Prompt 已生成: ${PROMPT_FILE}"
echo ""

# ─── 完成 ────────────────────────────────────────────
echo "  ┌─────────────────────────────────────────┐"
echo "  │           部署完成！                     │"
echo "  └─────────────────────────────────────────┘"
echo ""
echo "  下一步: 在 Cursor IDE 里打开项目，新建 Chat，发送:"
echo ""
echo "    阅读 .planning/proxy-system-prompt.md 然后按指令执行。"
echo ""
echo "  或者直接发送:"
echo ""
echo "    阅读 ${GSD2_DIR}/src/roles/proxy-prompt.template.md"
echo "    然后按指令执行。环境:"
echo "    HUB_CALL=${GSD2_DIR}/scripts/hub-call.sh"
echo "    CURSOR_CLI=${CURSOR_BIN}"
echo "    PROJECT_DIR=${PROJECT_DIR}"
echo "    HUB_PORT=${HUB_PORT}"
echo ""
echo "  常用命令:"
echo "    查看 Hub:       tail -f ${LOG_DIR}/hub.log"
echo "    查看 Agent:     tmux list-sessions | grep gsd2"
echo "    连入 Agent:     tmux attach -t gsd2-worker-01"
echo "    关闭所有:       tmux kill-server"
echo ""
