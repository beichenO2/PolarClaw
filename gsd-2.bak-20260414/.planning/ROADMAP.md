# Roadmap: gsd-2

## Overview

Deliver an MCP-based hub where multiple Cursor agents connect with stable sessions, durable state survives crashes and reconnects, tasks are claimed with leases and dependencies, broadcasts keep peers informed (SSE with poll fallback), `.planning/` stays authoritative with leases and atomic writes, configuration and intervention preferences are set once, agents run an honest loop with checkpoints and handoff, and safety plus observability close the v1 story.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: MCP Hub & durable sessions** — Streamable HTTP, session IDs, crash-safe persistence
- [x] **Phase 2: Broadcast, planning state & idempotent ops** — SSE + poll, versioned `.planning/`, idempotency
- [x] **Phase 3: Task model, claims & workflow** — DAG, split tasks, GSD phases, lease expiry to pool
- [x] **Phase 4: Path leases & configuration** — File leases, conflict signals, intervention matrix, config presets
- [x] **Phase 5: Autonomous loop & agent protocol** — Work loop, checkpoints, handoff, retries, agent registration & broadcast assist
- [x] **Phase 6: Safety limits & observability** — Hard caps, structured logs, audit trail, health, CLI status

## Phase Details

### Phase 1: MCP Hub & durable sessions
**Goal**: Multiple agents connect to one hub with stable identity; messages and hub state survive disconnect and process restart.
**Depends on**: Nothing (first phase)
**Requirements**: HUB-01, HUB-02, HUB-03, HUB-06
**Success Criteria** (what must be TRUE):
  1. Operator can run the MCP server in Streamable HTTP mode and connect more than one Cursor agent as separate sessions.
  2. Each connecting agent receives stable `agent_id` and `session_id` usable in later tool calls and logs.
  3. After an agent disconnects, persisted messages remain available so the agent can recover unprocessed work on reconnect.
  4. After hub process crash and restart, previously stored tasks and messages are still present (no silent loss of durable data).
**Plans**: TBD

### Phase 2: Broadcast, planning state & idempotent ops
**Goal**: Agents receive hub events in real time or via fallback; `.planning/` is the single versioned source of truth; mutations are safe to retry.
**Depends on**: Phase 1
**Requirements**: HUB-04, HUB-05, STATE-01, STATE-02, STATE-04, STATE-05
**Success Criteria** (what must be TRUE):
  1. When one agent publishes an event, all connected agents receive it via SSE push.
  2. When SSE is unavailable, an agent can still obtain new events using a poll-based tool path.
  3. Project state under `.planning/` is authoritative for all agents; updates use versioned documents and conflicting writes are rejected with a clear signal.
  4. File writes use atomic temp-and-rename so partially written planning artifacts never appear as valid state.
  5. Repeating the same hub tool call with the same idempotency key does not duplicate side effects.
**Plans**: TBD

### Phase 3: Task model, claims & workflow
**Goal**: Tasks are first-class with lifecycle, leases, dependencies, splitting, and workflow phase tags; stale work returns to the pool.
**Depends on**: Phase 2
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04, TASK-05, TASK-06, AUTO-04
**Success Criteria** (what must be TRUE):
  1. User can inspect tasks with id, status, owner, timestamps, and valid transitions including open → claimed → done/blocked/cancelled.
  2. Agent can claim a task and hold it with a time-bounded lease; heartbeat extends or confirms ownership.
  3. Dependent tasks stay blocked until upstream tasks complete (DAG semantics observable in task list/query).
  4. Parent task can be split into subtasks; when all children complete, parent completes automatically.
  5. Agent can list claimable work ordered by priority and dependency readiness.
  6. Tasks are associated with GSD workflow stages (discuss/research/plan/execute/verify) for filtering and reporting.
  7. When a lease expires without heartbeat, the task becomes available again for other agents to claim.
**Plans**: TBD

### Phase 4: Path leases & configuration
**Goal**: Concurrent file edits are coordinated via path leases and conflict signals; all automation preferences live in config with intervention presets.
**Depends on**: Phase 3
**Requirements**: STATE-03, CONF-01, CONF-02, CONF-03, CONF-04, CONF-05
**Success Criteria** (what must be TRUE):
  1. Before editing a file, an agent must obtain a lease from the hub for that path; conflicting requests surface as explicit conflict signals.
  2. User completes one-time project initialization that writes all preferences to `config.json`.
  3. User can set per–workflow-stage behavior (automatic, notify, or block for approval) via the intervention matrix.
  4. Agents load preferences from `config.json` at runtime and do not re-prompt for already-configured principle questions.
  5. After `config.json` is edited on disk, the next agent loop picks up changes without restarting the hub.
  6. User can start from automation presets (e.g. full auto / semi-auto / interactive) and customize from there.
**Plans**: TBD

### Phase 5: Autonomous loop & agent protocol
**Goal**: Agents run a documented pull→work→report loop with checkpoints, handoff, retries, registration, and summarized peer broadcasts.
**Depends on**: Phase 4
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-05, AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05
**Success Criteria** (what must be TRUE):
  1. Agent can drive a repeating cycle (get task → execute → report → wait) entirely via MCP tools without ad-hoc prompts.
  2. Each loop iteration can write a checkpoint file capturing progress and a short context summary for recovery.
  3. A new agent session can read the latest checkpoint and continue the same work (handoff).
  4. Transient failures trigger automatic retries with exponential backoff; permanent failure marks the task blocked and notifies peers.
  5. Packaged prompts/rules tell a fresh agent how to connect and use hub tools correctly.
  6. On connect, agent registers identity and capabilities; hub can use that data when offering tasks.
  7. During execution, agent can report started/progress/done/error through MCP tools.
  8. Agents can broadcast requests for help or problem reports; recipients see summarized content, not unbounded raw noise.
**Plans**: TBD

### Phase 6: Safety limits & observability
**Goal**: Operator-configured guardrails prevent runaway loops and cost; operations are auditable and inspectable from logs and CLI.
**Depends on**: Phase 5
**Requirements**: AUTO-06, OBS-01, OBS-02, OBS-03, OBS-04, OBS-05
**Success Criteria** (what must be TRUE):
  1. Operator can configure upper limits on tool calls per loop, token usage, and wall-clock time; the hub enforces them.
  2. Operator can read structured logs (e.g. pino) where entries include agent, task, and correlation identifiers.
  3. Operator can inspect an append-only audit trail of task transitions, messages, and lease operations.
  4. Operator can query aggregate progress: phase completion, active agents, queue depth.
  5. Operator receives health signals for stale agents, backlog buildup, or loop anomalies.
  6. Operator can run a CLI command to view overall system status without a GUI.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. MCP Hub & durable sessions | 0/TBD | Complete (integration tests) | 2026-04-08 |
| 2. Broadcast, planning state & idempotent ops | 0/TBD | Complete (e2e + docs) | 2026-04-08 |
| 3. Task model, claims & workflow | 0/TBD | Complete (e2e + docs) | 2026-04-08 |
| 4. Path leases & configuration | 0/TBD | Complete (e2e + docs) | 2026-04-08 |
| 5. Autonomous loop & agent protocol | 0/TBD | Complete (e2e + docs) | 2026-04-08 |
| 6. Safety limits & observability | 0/TBD | Complete (e2e + docs) | 2026-04-08 |
