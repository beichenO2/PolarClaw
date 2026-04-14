# Feature Landscape: MCP-Based Multi-Agent Collaboration (gsd-2)

**Domain:** Autonomous multi-agent software engineering via MCP Server + Cursor IDE agents  
**Researched:** 2026-04-07  
**Sources:** `.planning/PROJECT.md`; industry patterns for multi-agent orchestration and MCP-driven coordination (web, 2025–2026).  
**Overall confidence:** **MEDIUM** for generic “what frameworks tend to include” (surveys/blogs; not all claims independently verified against primary specs); **HIGH** for requirements explicitly stated in PROJECT.md.

---

## How to Read This Doc

| Label | Meaning |
|--------|---------|
| **Table stakes** | Without these, the system does not behave as a *coherent* multi-agent product (broken coordination, unsafe concurrency, or no autonomy). |
| **Differentiators** | Features that distinguish gsd-2 from *manual* GSD-1–style workflows (single session, file-indirect coordination, user-driven turns). |
| **Anti-features** | Deliberately out of scope or harmful if prioritized early (per PROJECT.md and architecture constraints). |

**Complexity:** Low / Med / High — engineering effort for a greenfield MCP-centric design, not absolute research certainty.

---

## 1. Agent Communication

*Broadcast, point-to-point, event subscriptions — MCP Server as hub.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **MCP tool surface for send/receive** | Agents only “talk” through tools the host exposes | Low–Med | Minimal contract: publish message, fetch inbox, acknowledge. |
| **Durable message store** | Cursor sessions are not a reliable bus; server must persist | Med | Enables reconnect and async peers. |
| **Agent identity** | Routing, permissions, audit | Low | Stable IDs (session + registered agent), not only display names. |
| **Broadcast / fan-out** | Core to gsd-2’s stated model | Med | One logical message → N subscribers; back-pressure policy needed. |
| **Point-to-point (direct messages)** | Table stakes for coordination (questions, handoffs) | Low–Med | Even in broadcast-first designs, P2P avoids noisy channels. |
| **Event subscriptions (topics)** | Without topics, broadcast becomes one noisy channel | Med | e.g. `task.*`, `phase.*`, `errors.*`; optional filter predicates. |
| **Delivery semantics documented** | At-least-once is typical; duplicates possible | Low | Consumers must idempotent-handle; document ordering per topic. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Peer-to-peer mental model on MCP** | No single orchestrator process; aligns with “equal agents” | Med–High | Server is *coordination* not *boss*; policies favor decentralized claiming. |
| **Workflow-aware channels** | Messages typed to GSD phases (discuss → … → verify) | Med | Reduces cross-talk vs generic chat. |
| **Structured payloads (schemas)** | Machines and agents agree on fields | Med | JSON Schema / Zod; versioned message types. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Replicating Slack/Discord in v1** | Huge surface; not the product | Lean topics + task linkage + logs. |
| **Arbitrary streaming video/audio** | Out of scope for engineering automation | Text + attachments/refs only. |
| **Hidden side channels** | Undermines audit and merge safety | All coordination through MCP-recorded messages. |

### Dependencies (communication)

```
Agent identity → routing (broadcast & P2P)
Durable store → recovery + observability (replay)
Topic subscriptions → scalable broadcast (avoid global flood)
Structured payloads → task/state tooling (downstream)
```

---

## 2. Task Management

*Assignment, splitting, dependency tracking.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Task record (id, status, owner, timestamps)** | Without it, no shared work | Low | Status: open/claimed/done/blocked/cancelled. |
| **Claim / lease pattern** | Prevents two agents editing same work | Med | TTL lease; heartbeat; re-queue on expiry. |
| **Dependency DAG or edges** | Ordering and parallelism | Med–High | Blocks/blocked-by; detect cycles. |
| **Splitting / decomposition** | Explicit in PROJECT.md | Med–High | Parent/child tasks; idempotent creation. |
| **Priority / ordering hints** | Fairness and starvation avoidance | Low–Med | Optional v1; can start with FIFO + phase. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Market-style claiming vs central assignment** | Fits broadcast + peer model | Med–High | “Pull” tasks from pool; optional escalation. |
| **Parallelism by design** | Exploits multiple Cursor windows | Med | Scheduler respects deps + file affinity. |
| **Phase-tied tasks** | Maps work to discuss → research → plan → execute → verify | Med | Bridges GSD mental model to runnable units. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Full Jira clone** | Not the MVP product | Thin task model + good exports later. |
| **Automatic splitting with no verification gate** | Can flood agents with bad subtasks | Human-configurable or verifier step per PROJECT preferences. |
| **Tasks with no link to repo artifacts** | Hard to audit | Link tasks to paths, commits, or plan IDs. |

### Dependencies (tasks)

```
Task records → claims/leases
Dependencies → scheduling order
Splitting → parent/child + optional approval (config)
Phase tags → workflow observability + messaging topics
```

---

## 3. State & Coordination

*Shared state, conflict resolution, locking.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Authoritative project state store** | Single source of truth beyond ad-hoc files | Med | Server-side; versioned documents. |
| **Optimistic concurrency (ETags / versions)** | Concurrent writes are guaranteed in multi-agent | Med | Retry on conflict with merge policy. |
| **File-granular locking or merge policy** | PROJECT.md: concurrent writes | Med–High | Lock *regions* or *paths*; or branch-per-agent with merge rules. |
| **Conflict surfacing to agents** | Humans won’t babysit | Med | Structured conflict object + suggested actions. |
| **Idempotent operations** | At-least-once delivery everywhere | Med | Applies to tasks, messages, state patches. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Policy-driven merge** (e.g. auto for docs, stop for codegen) | Reduces noise vs always-stop | High | Tied to one-time config / intervention points. |
| **Checkpointed workflow state** | Resume after disconnect | Med–High | Aligns with “autonomous” and finite context. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Distributed filesystem inside MCP** | Reinvent Git | Git as ground truth; MCP tracks coordination metadata. |
| **Implicit shared mutable globals** | Debugging nightmare | Named documents + versions + owners. |
| **Perfect CRDTs for all assets** | Often overkill for v1 | CRDT/select merge only where payoff is clear. |

### Dependencies (state)

```
Versioned state → safe broadcast of updates
Locks/leases → fewer conflict events; tie to task claims
Conflict types → observability + human intervention hooks
Checkpoints → autonomous operation / context recovery
```

---

## 4. Autonomous Operation

*Self-healing, retry, context recovery — “task → listen” loops.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Explicit agent loop semantics** | PROJECT.md: autonomous cycles | Med | Pull work → execute → report → wait/sleep policy. |
| **Retry with backoff (transient failures)** | Network/MCP/tool flakiness | Low–Med | Cap retries; dead-letter queue. |
| **Stale work detection** | Crashed agent leaves claimed tasks | Med | Lease expiry; heartbeat. |
| **Persistent checkpoints** | Context limits; session restarts | Med–High | “Where was I?” document per agent/task. |
| **Graceful degradation** | Single peer down shouldn’t corrupt global state | Med | Read-only mode, queue outbound, etc. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Handoff packages** | Another agent continues with minimal loss | Med–High | Summarized state + pointers to artifacts (plans, diffs). |
| **Autonomy levels per config** | One-time preference: how much to ask | Med | Maps to intervention matrix (next section). |
| **Self-healing playbooks** | Agent proposes recovery steps | High | Differentiator if reliable; start with retries + escalate. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Fully unattended destructive ops without gates** | Security/ trust | Configurable gates for merge/deploy/delete. |
| **Infinite retry loops** | Burn tokens / mask bugs | Max attempts + escalate to human or halt topic. |
| **Background OS daemons as v1 requirement** | PROJECT: no assumption of persistent agent process | Loop *inside* IDE-driven sessions + MCP timers/polling. |

### Dependencies (autonomy)

```
Checkpoints ← state store
Retries ← idempotency + task/message semantics
Leases ← task management + healing
Intervention config ← safe autonomy
```

---

## 5. Configuration & Preferences

*One-time setup, intervention points.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Single source of config (files + schema)** | “No repeated questions” is core | Low–Med | Validate on load; migrate versions. |
| **Agent roles / capabilities** | Routing and eligibility | Med | Optional v1 minimal: “worker” vs “lead”. |
| **Intervention matrix** | Which events pause for human (merge, phase transition, conflict) | Med | Event types × actions: notify / block / auto. |
| **Secrets handling** | API keys, tokens | Med | Env + host conventions; never in broadcast plaintext. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **One-shot initialization wizard** | UX for capturing all prefs once | Med | CLI/MCP; no GUI required in v1 per PROJECT.md. |
| **Automation aggressiveness presets** | Fast path for “firepower” users | Low–Med | Maps to defaults for retries, splitting depth, verification strictness. |
| **Policy packages (shareable)** | Team alignment | Med | Deferred if needed; differentiator for adoption. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Runtime pop-up preference dialogs** | Violates stated principle | Surface via logs + blocked tasks + MCP “intervention queue”. |
| **Per-message user questions** | Same | Encode defaults; escalate only on configured triggers. |

### Dependencies (config)

```
Intervention matrix → observability (what to show humans)
Roles → task eligibility + broadcast permissions
Secrets → secure MCP deployment docs
```

---

## 6. Observability

*Logging, progress tracking, human dashboards.*

### Table stakes

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Structured logs (correlation IDs)** | Debug multi-agent races | Med | Trace across agent, task, message. |
| **Audit trail of coordination** | Who claimed what, when | Med | Immutable append-only event log helps. |
| **Progress aggregates** | Phase/task completion | Low–Med | For human trust without reading every message. |
| **Health signals** | Stale agents, queue depth | Med | Enables healing and operator trust. |

### Differentiators

| Feature | Value proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **CLI “mission control”** | PROJECT.md excludes GUI v1 | Med | `status`, `tasks`, `tail`, `interventions` — acts as dashboard substitute. |
| **Export to files for GSD-style artifacts** | Continuity with GSD-1 mindset | Low–Med | Plans, research, verification in repo layout. |
| **Replay / simulation** | Learn from failures | High | Strong differentiator later. |

### Anti-features

| Anti-feature | Why avoid | What to do instead |
|--------------|-----------|-------------------|
| **Heavy web dashboard in v1** | Explicitly out of scope | CLI + MCP + optional static HTML later. |
| **Verbose raw LLM dumps in broadcast** | Privacy + noise | Summaries + links to artifacts. |

### Dependencies (observability)

```
Correlation IDs → every message/task update carries them
Audit trail → feeds CLI and post-mortems
Progress → task + phase model
```

---

## Cross-Cutting Feature Dependency Graph

```
Configuration (schema, intervention matrix)
    ↓
Agent identity + roles
    ↓
Durable messaging (broadcast / P2P / topics) + structured payloads
    ↓
Task model (claims, deps, phases) ←→ State store (versioning, locks)
    ↓
Autonomous loops + checkpoints + retries
    ↓
Observability (logs, audit, CLI “dashboard”)
```

**Critical path for “it works”:** identity → durable messaging → task claim/lease → versioned state → checkpoints → structured logs.

---

## Table Stakes vs Differentiators (Summary)

| Area | Table stakes (must work) | Differentiators (vs manual GSD-1) |
|------|--------------------------|-------------------------------------|
| **Communication** | MCP tools, durable store, identity, broadcast + P2P + topics, delivery rules | Peer-first coordination; phase-aware channels; schema-first messages |
| **Tasks** | Records, claims/leases, deps, splitting | Market-style claiming; parallelism; phase-tied work units |
| **State** | Versioned authority, merge/lock policy, idempotency | Policy-driven automation; checkpoints tuned for IDE agents |
| **Autonomy** | Loop semantics, retries, lease healing, checkpoints | Handoff packages; autonomy presets; playbooks (later) |
| **Config** | Single config source, intervention matrix, secrets discipline | One-shot init; aggressiveness presets |
| **Observability** | Structured logs, audit, progress, health | CLI mission control; artifact export; replay (later) |

---

## MVP Recommendation (Feature Prioritization)

**Ship first (coherent MVP):**

1. **Identity + durable messaging** (minimal broadcast + P2P + one topic namespace).
2. **Task pool with claim/lease + basic dependency edges** (no fancy scheduler).
3. **Versioned state documents** for plan/progress + optimistic concurrency.
4. **Checkpoint + handoff summary** for context recovery.
5. **Config file + intervention matrix** (block/notify/auto for a small set of events).
6. **Structured logging + CLI status** (not a GUI).

**Defer:** advanced CRDT merge, full replay, rich role hierarchies, policy packages marketplace.

**Explicitly defer per PROJECT.md:** graphical management UI; multi-IDE parity; model training.

---

## Anti-Features (Project-Wide, Reinforced)

| Anti-feature | Rationale |
|--------------|-----------|
| Forking or importing GSD-1 code | Architecture independence (PROJECT.md) |
| v1 multi-IDE simultaneous support | Cursor-first; extension points only |
| Proprietary model training | Use existing LLMs |
| Heavy graphical admin UI in v1 | CLI + MCP only |
| “Chat app” collaboration | Engineering coordination, not social messaging |
| Omniscient central orchestrator that micromanages every tool call | Conflicts with peer-to-peer goals; server coordinates, does not replace agent judgment everywhere |

---

## Gaps / Phase-Specific Research Later

- **Exact MCP capability matrix in Cursor** (which transports, limits, auth) — verify against current Cursor + MCP docs at implementation time.
- **MCP v2 / OAuth / elicitation** — may change how “intervention” and “one-time config” are enforced at the protocol layer.
- **Optimal lease TTLs and fairness** under N parallel agents — likely needs measurement, not theory.

---

## Sources

- `.planning/PROJECT.md` — authoritative for gsd-2 scope, constraints, and differentiators.
- Industry summaries (2025–2026) on multi-agent orchestration patterns (graph, handoff, shared state, checkpointing) — **MEDIUM confidence**; use for vocabulary and common patterns, not as normative requirements.
- MCP multi-agent pattern articles (IBM, Microsoft, ecosystem blogs) — **MEDIUM confidence**; validate critical claims against [MCP specification](https://modelcontextprotocol.io) during design phases.
