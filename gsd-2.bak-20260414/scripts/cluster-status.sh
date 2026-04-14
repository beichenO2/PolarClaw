#!/bin/bash
# cluster-status.sh — Display gsd-2 cluster health at a glance
#
# Uses project-isolated prefix — only shows this project's sessions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

echo "╔══════════════════════════════════════════╗"
echo "║  gsd-2 集群状态 [$GSD_PROJECT_HASH]      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- tmux sessions ---
echo "▸ Sessions (前缀: $TMUX_PREFIX)"
SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${TMUX_PREFIX}-" | sort || true)
if [ -z "$SESSIONS" ]; then
  echo "  (无 ${TMUX_PREFIX}-* sessions)"
else
  HUB_COUNT=$(echo "$SESSIONS" | grep -c "^${TMUX_PREFIX}-hub$" || true)
  CTRL_COUNT=$(echo "$SESSIONS" | grep -c "^${TMUX_PREFIX}-ctrl" || true)
  SUPER_COUNT=$(echo "$SESSIONS" | grep -c "^${TMUX_PREFIX}-super$" || true)
  WORKER_COUNT=$(echo "$SESSIONS" | grep -c "^${TMUX_PREFIX}-w" || true)
  STANDBY_COUNT=$(echo "$SESSIONS" | grep -c "^${TMUX_PREFIX}-sb" || true)
  TOTAL=$(echo "$SESSIONS" | wc -l | tr -d ' ')
  echo "  总计: $TOTAL | Hub: $HUB_COUNT | Ctrl: $CTRL_COUNT | Super: $SUPER_COUNT | Workers: $WORKER_COUNT | Standby: $STANDBY_COUNT"
fi
echo ""

# --- Hub connectivity ---
echo "▸ Hub (port $HUB_PORT)"
if curl -s --max-time 3 "http://127.0.0.1:$HUB_PORT/mcp" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"status","version":"1.0"}},"id":0}' 2>/dev/null | grep -q 'gsd-2-hub'; then
  echo "  状态: ONLINE"
else
  echo "  状态: OFFLINE"
  echo ""
  exit 1
fi
echo ""

# --- Roles ---
echo "▸ 角色"
rm -f /tmp/gsd2-session-status-$$
ROLES=$("$HUB_CALL" "status-$$" hub_register '{"agent_id":"status-check"}' > /dev/null 2>&1 && "$HUB_CALL" "status-$$" hub_get_roles '{}' 2>/dev/null || echo '{"roles":[]}')
echo "$ROLES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
roles=d.get('roles',[])
by_role={}
for r in roles:
    role=r['role']
    by_role.setdefault(role,[]).append(r)
for role in ['proxy','controller','supervisor','worker']:
    agents=by_role.get(role,[])
    active=[a for a in agents if a['status']=='active']
    print(f'  {role:12s}: {len(active)} active')
" 2>/dev/null || echo "  (读取失败)"
echo ""

# --- Tasks ---
echo "▸ 任务"
TASKS=$("$HUB_CALL" "status-$$" hub_list_tasks '{}' 2>/dev/null || echo '{"tasks":[]}')
echo "$TASKS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tasks=d.get('tasks',[])
sc={}
for t in tasks:
    sc[t['status']]=sc.get(t['status'],0)+1
total=len(tasks)
done=sc.get('done',0)
pct=int(done/total*100) if total else 0
bar_len=20
filled=int(bar_len*pct/100)
bar='█'*filled+'░'*(bar_len-filled)
print(f'  [{bar}] {pct}% ({done}/{total})')
print(f'  done: {sc.get(\"done\",0)} | claimed: {sc.get(\"claimed\",0)} | open: {sc.get(\"open\",0)} | blocked: {sc.get(\"blocked\",0)}')
" 2>/dev/null || echo "  (读取失败)"
echo ""

# --- Health ---
echo "▸ 健康"
HEALTH=$("$HUB_CALL" "status-$$" hub_get_health '{}' 2>/dev/null || echo '{"health":{}}')
echo "$HEALTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
h=d.get('health',{})
stale=h.get('stale_agents',[])
print(f'  活跃任务: {h.get(\"active_tasks\",0)} | 队列深度: {h.get(\"queue_depth\",0)}')
print(f'  Stale agents: {len(stale)}')
" 2>/dev/null || echo "  (读取失败)"

rm -f "/tmp/gsd2-session-status-$$"

echo ""
echo "▸ Agent 重启状态"
STATE_DIR="$PROJECT_DIR/.planning/agent-state"
if [ -d "$STATE_DIR" ] && ls "$STATE_DIR"/*.json >/dev/null 2>&1; then
  python3 -c "
import json,glob,os
states=[]
for f in sorted(glob.glob('$STATE_DIR/*.json')):
    if os.path.basename(f)=='launched.json': continue
    try:
        with open(f) as fh: d=json.load(fh)
        states.append(d)
    except: pass
if not states:
    print('  (无状态文件)')
else:
    total_restarts=sum(s.get('restarts',0) for s in states)
    rapid=[s for s in states if s.get('last_runtime_sec',999)<10]
    print(f'  Agent 数: {len(states)} | 总重启次数: {total_restarts} | 快速退出(<10s): {len(rapid)}')
    for s in sorted(states, key=lambda x: -x.get('restarts',0))[:5]:
        name=s.get('agent','?')
        restarts=s.get('restarts',0)
        runtime=s.get('last_runtime_sec',0)
        backoff=s.get('backoff',5)
        print(f'  {name:12s}: {restarts:3d} restarts | last runtime: {runtime:4d}s | backoff: {backoff}s')
" 2>/dev/null || echo "  (读取失败)"
else
  echo "  (无状态文件)"
fi

echo ""
echo "▸ 系统资源"
AGENT_PROCS=$(ps aux 2>/dev/null | grep 'cursor-agent.*--print' | grep -v grep | wc -l | tr -d ' ')
echo "  cursor-agent 进程: $AGENT_PROCS"
ALL_SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | wc -l | tr -d ' ')
echo "  全局 tmux sessions: $ALL_SESSIONS"
LOAD=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2, $3, $4}' || uptime 2>/dev/null | awk -F'load averages?:' '{print $2}' | tr -d ' ')
echo "  系统负载: $LOAD"
echo ""
