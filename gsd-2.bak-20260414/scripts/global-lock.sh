#!/bin/bash
# global-lock.sh — Cross-project global resource lock for gsd-2
#
# Manages ~/.gsd2/global-lock.json to coordinate agent resource locking
# across multiple projects on the same machine.
#
# Usage:
#   ./global-lock.sh register               # Register this project (confirmed: false)
#   ./global-lock.sh confirm                 # Confirm this project
#   ./global-lock.sh unconfirm               # Revert confirmation (only before global lock)
#   ./global-lock.sh check                   # Exit 0 if globally locked, 1 if not
#   ./global-lock.sh status                  # Show all projects and lock state
#   ./global-lock.sh is-confirmed            # Exit 0 if THIS project confirmed, 1 if not
#   ./global-lock.sh unlock --force          # Emergency unlock (requires --force)
#   ./global-lock.sh deregister              # Remove this project from lock file
#
# All operations use project isolation from lib-isolate.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

LOCK_DIR="$HOME/.gsd2"
LOCK_FILE="$LOCK_DIR/global-lock.json"
ACTION="${1:-status}"
FORCE_FLAG="${2:-}"

mkdir -p "$LOCK_DIR"

# 如果 lock 文件不存在，创建空结构
if [ ! -f "$LOCK_FILE" ]; then
  echo '{"locked":false,"projects":{},"locked_at":null}' > "$LOCK_FILE"
fi

read_lock() {
  cat "$LOCK_FILE"
}

write_lock() {
  local DATA="$1"
  echo "$DATA" > "$LOCK_FILE"
}

case "$ACTION" in
  register)
    TOTAL_SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -c "^${TMUX_PREFIX}-" 2>/dev/null || echo "0")
    TOTAL_SESSIONS=$(echo "$TOTAL_SESSIONS" | tr -d '[:space:]')
    [ -z "$TOTAL_SESSIONS" ] && TOTAL_SESSIONS=0
    _GL_LOCK_FILE="$LOCK_FILE" \
    _GL_HASH="$GSD_PROJECT_HASH" \
    _GL_DIR="$PROJECT_DIR" \
    _GL_SESSIONS="$TOTAL_SESSIONS" \
    _GL_PORT="$HUB_PORT" \
    python3 -c "
import json, sys, datetime, os
lock_file = os.environ['_GL_LOCK_FILE']
proj_hash = os.environ['_GL_HASH']
proj_dir = os.environ['_GL_DIR']
sessions = int(os.environ.get('_GL_SESSIONS', '0'))
port = int(os.environ['_GL_PORT'])
with open(lock_file, 'r') as f:
    data = json.load(f)
if data.get('locked', False):
    print('ERROR: 全局已锁定，不允许注册新项目')
    sys.exit(1)
data['projects'][proj_hash] = {
    'project_dir': proj_dir,
    'confirmed': False,
    'agent_count': sessions,
    'hub_port': port,
    'initialized_at': datetime.datetime.now().isoformat(),
    'confirmed_at': None
}
with open(lock_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print(f'已注册项目 {proj_hash} (端口 {port})')
"
    ;;

  confirm)
    _GL_LOCK_FILE="$LOCK_FILE" \
    _GL_HASH="$GSD_PROJECT_HASH" \
    _GL_PREFIX="$TMUX_PREFIX" \
    python3 -c "
import json, sys, datetime, subprocess, os
lock_file = os.environ['_GL_LOCK_FILE']
proj_hash = os.environ['_GL_HASH']
prefix = os.environ['_GL_PREFIX']
with open(lock_file, 'r') as f:
    data = json.load(f)
proj = data['projects'].get(proj_hash)
if not proj:
    print(f'ERROR: 项目 {proj_hash} 未注册')
    sys.exit(1)
proj['confirmed'] = True
proj['confirmed_at'] = datetime.datetime.now().isoformat()
try:
    result = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'], capture_output=True, text=True)
    count = len([s for s in result.stdout.strip().split(chr(10)) if s.startswith(prefix + '-')])
    proj['agent_count'] = count
except:
    pass
all_confirmed = all(p.get('confirmed', False) for p in data['projects'].values())
if all_confirmed and len(data['projects']) > 0:
    data['locked'] = True
    data['locked_at'] = datetime.datetime.now().isoformat()
    print(f'✓ 项目 {proj_hash} 已确认')
    print('🔒 所有项目已确认 — 全局资源锁定！')
    total_agents = sum(p.get('agent_count', 0) for p in data['projects'].values())
    print(f'   锁定项目数: {len(data[\"projects\"])}')
    print(f'   总 Agent 数: {total_agents}')
else:
    pending = [h for h, p in data['projects'].items() if not p.get('confirmed', False)]
    print(f'✓ 项目 {proj_hash} 已确认')
    print(f'⏳ 等待其他项目确认: {pending}')
with open(lock_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
"
    ;;

  unconfirm)
    _GL_LOCK_FILE="$LOCK_FILE" _GL_HASH="$GSD_PROJECT_HASH" python3 -c "
import json, sys, os
lock_file = os.environ['_GL_LOCK_FILE']
proj_hash = os.environ['_GL_HASH']
with open(lock_file, 'r') as f:
    data = json.load(f)
if data.get('locked', False):
    print('ERROR: 全局已锁定，不能取消确认')
    sys.exit(1)
proj = data['projects'].get(proj_hash)
if not proj:
    print(f'ERROR: 项目 {proj_hash} 未注册')
    sys.exit(1)
proj['confirmed'] = False
proj['confirmed_at'] = None
with open(lock_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print(f'项目 {proj_hash} 已取消确认')
"
    ;;

  check)
    _GL_LOCK_FILE="$LOCK_FILE" python3 -c "
import json, sys, os
with open(os.environ['_GL_LOCK_FILE'], 'r') as f:
    data = json.load(f)
sys.exit(0 if data.get('locked', False) else 1)
"
    ;;

  is-confirmed)
    _GL_LOCK_FILE="$LOCK_FILE" _GL_HASH="$GSD_PROJECT_HASH" python3 -c "
import json, sys, os
with open(os.environ['_GL_LOCK_FILE'], 'r') as f:
    data = json.load(f)
proj = data['projects'].get(os.environ['_GL_HASH'])
sys.exit(0 if proj and proj.get('confirmed', False) else 1)
"
    ;;

  status)
    _GL_LOCK_FILE="$LOCK_FILE" python3 -c "
import json, os
with open(os.environ['_GL_LOCK_FILE'], 'r') as f:
    data = json.load(f)
print('╔══════════════════════════════════════════╗')
if data.get('locked', False):
    print('║  🔒 全局资源已锁定                       ║')
else:
    print('║  🔓 全局资源未锁定                       ║')
print('╚══════════════════════════════════════════╝')
print()
projects = data.get('projects', {})
if not projects:
    print('  (无注册项目)')
else:
    for h, p in projects.items():
        st = '✓ 已确认' if p.get('confirmed') else '⏳ 待确认'
        print(f'  [{h}] {st}')
        print(f'    目录: {p.get(\"project_dir\", \"?\")}')
        print(f'    端口: {p.get(\"hub_port\", \"?\")} | Agent数: {p.get(\"agent_count\", \"?\")}')
        print()
if data.get('locked_at'):
    print(f'锁定时间: {data[\"locked_at\"]}')
"
    ;;

  unlock)
    if [ "$FORCE_FLAG" != "--force" ]; then
      echo "ERROR: 解锁需要 --force 参数（紧急操作）"
      exit 1
    fi
    _GL_LOCK_FILE="$LOCK_FILE" python3 -c "
import json, os
lock_file = os.environ['_GL_LOCK_FILE']
with open(lock_file, 'r') as f:
    data = json.load(f)
data['locked'] = False
data['locked_at'] = None
for p in data['projects'].values():
    p['confirmed'] = False
    p['confirmed_at'] = None
with open(lock_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print('⚠️  全局锁已强制解除，所有项目确认状态已重置')
"
    ;;

  deregister)
    _GL_LOCK_FILE="$LOCK_FILE" _GL_HASH="$GSD_PROJECT_HASH" _GL_FORCE="$FORCE_FLAG" python3 -c "
import json, sys, os
lock_file = os.environ['_GL_LOCK_FILE']
proj_hash = os.environ['_GL_HASH']
force = os.environ.get('_GL_FORCE', '')
with open(lock_file, 'r') as f:
    data = json.load(f)
if data.get('locked', False) and force != '--force':
    print('ERROR: 全局已锁定，不能反注册（需要 --force）')
    sys.exit(1)
if proj_hash in data['projects']:
    del data['projects'][proj_hash]
    if not data['projects']:
        data['locked'] = False
        data['locked_at'] = None
    with open(lock_file, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'项目 {proj_hash} 已从全局锁中移除')
else:
    print(f'项目 {proj_hash} 不在全局锁中')
"
    ;;

  *)
    echo "Usage: global-lock.sh {register|confirm|unconfirm|check|is-confirmed|status|unlock|deregister}"
    exit 1
    ;;
esac
