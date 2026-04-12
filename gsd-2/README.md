# gsd-2

MCP-based autonomous multi-agent collaboration framework. Multiple Cursor agents coordinate through a central Hub using the Model Context Protocol.

## Quick Start

### Prerequisites

- Node.js 22+
- tmux
- [Cursor IDE](https://cursor.com) with CLI (`cursor agent`)

### Install

```bash
git clone https://github.com/beichenO2/gsd-2.git
cd gsd-2
npm install
```

### Launch Cluster

```bash
# Start Hub + Controller + Supervisor + 5 Workers
./scripts/launch-cluster.sh

# Or specify worker count
./scripts/launch-cluster.sh 10

# Specify model for all agents
./scripts/launch-cluster.sh 5 --model claude-4.6-opus-high
```

### Monitor

```bash
./scripts/cluster-status.sh
```

Output:
```
▸ Sessions
  总计: 8 | Hub: 1 | Ctrl: 1 | Super: 1 | Workers: 5

▸ 任务
  [████████████░░░░░░░░] 60% (12/20)
  done: 12 | claimed: 3 | open: 5
```

### Stop

```bash
# Stop everything
./scripts/stop-cluster.sh

# Stop agents only, keep Hub running
./scripts/stop-cluster.sh --keep-hub
```

### Test (headless, no cursor agents needed)

```bash
./scripts/test-e2e-cluster.sh
```

### Hub Watchdog

```bash
# Auto-restart Hub on crash (standalone or via launch flag)
./scripts/hub-watchdog.sh
./scripts/launch-cluster.sh 5 --watchdog
```

### Hub API (via hub-call.sh)

```bash
# Register an agent
./scripts/hub-call.sh my-agent hub_register '{"agent_id":"my-agent"}'

# Create a task
./scripts/hub-call.sh proxy hub_create_task '{"creator_agent_id":"proxy","title":"Build feature X","workflow_stage":"execute"}'

# List tasks
./scripts/hub-call.sh proxy hub_list_tasks '{}'

# Publish event
./scripts/hub-call.sh proxy hub_publish '{"agent_id":"proxy","topic":"controller.inbox","payload":{"type":"directive"}}'
```

## Architecture

```
┌──────────┐     ┌──────────────────────────┐     ┌──────────┐
│  Proxy   │────▶│  MCP Hub (auto port)     │◀────│  Ctrl    │
│ (user)   │     │  SQLite · SSE · REST     │     │(dispatch)│
└──────────┘     └──────────────────────────┘     └──────────┘
                          ▲    ▲    ▲
                    ┌─────┘    │    └─────┐
                    │          │          │
              ┌─────┴──┐ ┌────┴───┐ ┌────┴───┐
              │Worker 1 │ │Worker 2│ │Worker N│
              │(execute)│ │(execute│ │(execute│
              └────────┘ └────────┘ └────────┘
```

- **Proxy**: User-facing agent, sends phase objectives
- **Controller**: Receives objectives, splits into tasks
- **Supervisor**: Reviews completed work quality
- **Workers**: Claim tasks, write code, run tests

## Hub Tools

| Tool | Purpose |
|------|---------|
| `hub_register` | Register agent identity |
| `hub_assign_role` | Assign system role |
| `hub_publish` | Broadcast events (`agent_id` + `topic` + `payload`) |
| `hub_poll_events` | Poll for new events |
| `hub_create_task` | Create task (`creator_agent_id` + `title` + `workflow_stage`) |
| `hub_claim_task` | Claim next available task |
| `hub_complete_task` | Mark task done (`agent_id` + `task_id`) |
| `hub_list_tasks` | List/filter tasks |
| `hub_get_health` | System health check |
| `hub_get_progress` | Progress by workflow stage |
| `hub_checkpoint` | Save agent checkpoint |
| `hub_handoff` | Resume from checkpoint |

## Role Prompt Templates

Standardized prompt templates live in `src/roles/`:

- `proxy-prompt.template.md` — Full proxy bootstrap instructions (IDE agent)
- `controller-prompt.template.md` — Task dispatch loop
- `supervisor-prompt.template.md` — Quality review loop
- `worker-prompt.template.md` — Task execution loop
- `partition-ctrl-prompt.template.md` — Domain partition controller
- `global-clk-prompt.template.md` — Cross-project coordinator

Templates use `{{AGENT_ID}}` and `{{HUB_CALL}}` placeholders, resolved by `launch-cluster.sh`.

## Agent Lifecycle

Agents use `cursor agent --print --yolo` (one-shot mode). The launcher wraps this in a `while true` loop with **exponential backoff**:

- Normal exit (runtime > 2min): reset wait to 5s
- Fast exit (runtime < 2min): double wait (max 5min)
- Rapid restart throttle: >10 restarts in 60s triggers 5min cooldown
- State tracking: each agent writes `.planning/agent-state/<name>.json`

On restart, agents receive a resumption context that skips initialization.

## License

MIT
