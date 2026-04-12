# Project Research Summary

**Project:** gsd-2  
**Domain:** MCP-based autonomous multi-agent collaboration — independent Cursor IDE agents coordinate via an MCP server hub (broadcast, task/listen loops, minimal human intervention).  
**Researched:** 2026-04-07  
**Confidence:** **MEDIUM** overall (HIGH on MCP spec and core libraries; MEDIUM on Cursor-specific limits and transport UX).

---

## Executive Summary

gsd-2 is a **coordination hub**, not a generic chat or orchestrator-in-the-cloud product. Experts build this by implementing an **official MCP TypeScript server** (`@modelcontextprotocol/sdk`), exposing a **small, schema-validated tool surface**, and persisting **authoritative state** outside the LLM (files and/or SQLite) so agents can resume after disconnects, Continue waves, and peer contention.

The **recommended approach**: run **one long-lived hub process** using **Streamable HTTP** (not stdio) so multiple Cursor sessions get distinct **`Mcp-Session-Id`** values and the hub can **fan out** broadcasts (per-session SSE per spec). Pair that with **durable messaging, task claim/lease, versioned coordination state, idempotent operations, and structured logging** (stderr — never stdout on stdio paths). Treat **facts** (versioned store) as authoritative; treat **broadcasts** as notifications agents must reconcile against the store.

**Key risks:** Cursor **tool-definition and turn limits**, uncertain **GET SSE** behavior per client build, **stdio vs HTTP** topology if the team ships stdio first, **last-writer-wins** on shared files without leases, and **runaway loops / fake completion** without server-enforced caps and verification gates. Mitigate with minimal tools, batch-friendly hub APIs, path leases, atomic writes under `.planning/`, hard limits on tool calls and retries, and explicit checkpoint + handoff artifacts.

---

## 1. Recommended Stack (Key Libraries and Versions)

Verified pins from `STACK.md` (npm as of 2026-04-07):

| Layer | Library | Version | Role |
|-------|---------|---------|------|
| MCP | `@modelcontextprotocol/sdk` | **1.29.0** | Official server/client; Streamable HTTP / stdio via SDK |
| Validation | `zod` | **4.3.6** | Tool I/O and config at boundaries (SDK peer: `^3.25 \|\| ^4.0`) |
| JSON Schema | `@cfworker/json-schema` | **^4.1.1** | SDK peer; JSON Schema interop |
| Runtime | Node.js | **22.x LTS** (or **20.x LTS**) | Require Node 18 or newer |
| Persistence (recommended in STACK for ACID hub) | `better-sqlite3` | **12.8.0** | Durable tasks, locks, idempotency under contention |
| ORM | `drizzle-orm` | **0.45.2** | Typed queries, migrations |
| Optional queue (rich semantics) | `bullmq` / `ioredis` | **5.73.0** / **5.10.1** | Redis **7.x** — defer if SQLite-only v1 suffices |
| Postgres queue alt | `pg-boss` | **12.15.0** | If Postgres already present; no Redis |
| FS watch | `chokidar` | **5.0.0** | Cross-platform workspace watching |
| Logging | `pino` | **10.3.1** | Structured logs → **stderr** or file (never MCP stdout) |
| IDs | `nanoid` | **5.1.7** | Task/event correlation |
| Dev / test | `tsx` **4.21.0**, `vitest` **4.1.2** | | |

**Transports:** Prefer **Streamable HTTP** for a true multi-session hub; **stdio** implies separate processes — hub state must use a **shared store** (DB/files). Do **not** implement legacy **HTTP+SSE** (2024-11-05); use **Streamable HTTP** (optional SSE inside). **WebSocket** is not a standard MCP transport for Cursor-facing paths.

**Note:** `ARCHITECTURE.md` sketches **file-first** authority under `.planning/hub/` for v1; `STACK.md` argues **SQLite + Drizzle** for ACID under multi-agent races. **Resolve in implementation:** either atomic files + JSONL/event log with strict single-writer discipline, or SQLite early — do not rely on unconstrained shared JSON files for hot paths.

---

## 2. Table Stakes Features (Must-Haves for v1)

From `FEATURES.md` — without these the system is not a coherent multi-agent product:

**Communication**

- MCP **tool surface** for send/receive (publish, inbox, ack).
- **Durable message store** (sessions are not a reliable bus).
- **Agent identity** (stable IDs, routing, audit).
- **Broadcast + point-to-point + topics** with documented **delivery semantics** (at-least-once typical; idempotent consumers).

**Tasks**

- Task records: id, status, owner, timestamps; **claim/lease** with TTL and heartbeat.
- **Dependency edges** (DAG or equivalent); **splitting** (parent/child) per project goals.

**State & coordination**

- **Authoritative server-side state**; **optimistic concurrency** (versions/ETags).
- **File-granular leases** or merge policy; **conflict surfacing** to agents; **idempotent** mutations.

**Autonomous operation**

- Explicit **loop semantics** (pull work → execute → report); **retry with backoff**; **stale work** via lease expiry; **persistent checkpoints**; **graceful degradation** when peers are down.

**Configuration**

- **Single validated config**; **intervention matrix** (what blocks vs notifies); **secrets** not in broadcast plaintext.

**Observability**

- **Structured logs** with correlation IDs; **audit trail**; **progress aggregates**; **health signals** (stale agents, queue depth).

**MVP slice (coherent first ship):** identity + minimal durable messaging → task pool with claim/lease + basic deps → versioned state docs → checkpoint/handoff → config + intervention matrix → structured logging + CLI-style status (no heavy GUI).

---

## 3. Key Architecture Decisions

From `ARCHITECTURE.md`, aligned with `STACK.md` where compatible:

1. **One hub process, Streamable HTTP** — Multiple agents = multiple MCP **sessions** (`Mcp-Session-Id`); stdio-per-agent does **not** share one in-memory graph without external store.
2. **Server-mediated visibility** — Agents never talk peer-to-peer; all cross-agent traffic through the hub (optional read-only recovery via `.planning/`).
3. **Module boundaries:** transport adapter → session registry → task service → lock/conflict service → event log + broadcast → persistence adapter → tool handlers.
4. **Broadcast:** append durable **event log**, fan-out as **N single-stream SSE sends** (logical broadcast); **poll fallback** (`hub_poll_events`) if GET SSE is unreliable in the client.
5. **Conflict model:** **prevent** (path leases) and **detect** (hash/git checks), then **escalate** — hub coordinates **who may touch what**; **git** is textual merge arbiter.
6. **Agent loop honesty:** No daemon inside Cursor — autonomy is **batched tools + checkpoints + Continue**; design for **tool call budgets** (~20–30 calls per interaction cited in architecture — **validate in product**).
7. **Persistence split (v1 tension):** Architecture doc favors **files under `.planning/hub/`** + in-memory indexes; stack research favors **SQLite** for races. Pick one authoritative strategy before parallel agents hit the same artifacts.

---

## 4. Critical Pitfalls to Watch

From `PITFALLS.md` (prioritized for gsd-2):

| # | Pitfall | Prevention |
|---|---------|------------|
| 1 | **stdio / tool sprawl / Cursor limits** — Many tools or wrong transport break discovery and stability. | **Minimize tool count**; collapse domain ops inside server; **Streamable HTTP** for multi-client hub; **smoke-test** Cursor version + config. |
| 2 | **Autonomy without guardrails** — Micro-loops, fake “done,” cost explosions. | **Hard caps** (`max_tool_calls`, wall time, cost); **loop detection**; **verification gates**; external state before COMPLETE. |
| 3 | **Concurrent edits** — Lost updates, torn JSON, git mess. | **Leases** via MCP; **atomic writes** (temp + rename); append-only event log; **branch or serialize** write-heavy work. |
| 4 | **Context loss** — Decisions only in chat. | **Checkpoints**; mandatory re-read of `PROJECT.md` / task index at loop boundaries; chunk work. |
| 5 | **Continue / no background agent** — Stalls until user or hosted harness. | **Durable task queue + handoff**; **CONTINUE contract** in files; don’t tie liveness to chat length — use **leases + heartbeat**. |
| 6 | **O(N²) broadcast noise** — Token blowups with many agents. | **Summaries/diffs**, subscriptions, budgets per role. |
| 7 | **`.planning/` split-brain** — Duplicate phase IDs, partial writes. | **Authoritative index** (single writer path); **version counters**; MCP-owned mutations for critical indices. |
| 8 | **Server crash / duplicate side effects** | **Idempotent tools**; validate inputs — **no uncaught throws**; journal before irreversible effects; recovery poll. |

**Cross-cutting:** Do not treat broadcast prose as truth — reconcile to **versioned store**.

---

## 5. Recommended Build Order

Merged from `ARCHITECTURE.md` §10 and `FEATURES.md` critical path:

1. **Streamable HTTP skeleton + session lifecycle** — `Mcp-Session-Id`, health, session DELETE; blocks everything.
2. **Persistence layout + crash-safe writes** — Under `.planning/hub/` and/or SQLite schema; single-writer rules.
3. **Task model + claim / release / idempotency keys + event append** — Core product value.
4. **Broadcast fan-out** — SSE first, **poll fallback** second.
5. **Path leases + conflict signals** — Safe parallel editing.
6. **Agent harness** — Rules/prompt pack, batch hub tools (`hub_sync`-style), checkpoint semantics for **Continue**.
7. **Safety + hardening** — Caps, loop detection, intervention matrix enforcement; Origin/auth if not only loopback; observability and recovery drills.

**Parallel research note:** If v1 stays **SQLite-only** vs adds **Redis/BullMQ**, profile with realistic agent counts before operational complexity.

---

## 6. Open Questions That Need Validation

| Question | Why it matters |
|----------|----------------|
| **Cursor** support for **Streamable HTTP** + **GET SSE** per session | Architecture assumes SSE push; may need **poll-first MVP**. |
| **Exact** `mcp.json` / **streamableHttp** config and multi-window behavior | Affects hub topology and testing checklist. |
| **Tool call / Continue limits** in **your** Cursor build | Drives batching and checkpoint frequency. |
| **File vs SQLite** as **authoritative** store for v1 | ARCH vs STACK tradeoff; contention experiments decide. |
| **Lease TTLs and fairness** under N parallel agents | Likely measurement, not theory. |
| **MCP SDK v2** GA and migration | STACK says avoid alpha v2 for production until stable. |
| **MCP OAuth / elicitation** changes | May affect intervention and one-time config enforcement. |

---

## Key Findings (Condensed)

### Expected Features

**Should-have differentiators:** Peer-first coordination, phase-aware channels, schema-first messages, market-style claiming, CLI “mission control,” handoff packages.

**Defer:** Full CRDT merge, replay/simulation, rich role hierarchies, heavy web dashboard, replicating Slack/Discord, forking GSD-1 code (per `PROJECT.md`).

### Implications for Roadmap

Suggested phase alignment with `PITFALLS.md`:

| Suggested phase | Focus | Research flag |
|-----------------|-------|---------------|
| **P1 — MCP core** | Transport, minimal tools, error handling, smoke tests | **HIGH** — validate Cursor MCP matrix |
| **P2 — Protocol** | Broadcast semantics, schemas, ordering, anti-flood | **MEDIUM** — event shape + summarization |
| **P3 — Shared state** | `.planning/` or SQLite, leases, atomicity | **MEDIUM** — storage choice |
| **P4 — Agent harness** | Loops, checkpoints, handoff, CONTINUE | **HIGH** — product limits |
| **P5 — Safety** | Caps, verification, loop detection | **MEDIUM** — policy tuning |
| **P6 — Hardening** | Recovery, observability, Cursor upgrade regression | **MEDIUM** |

**Standard patterns (lighter research):** Structured logging (pino), zod boundaries, Vitest tests, append-only event logs.

### Phase Ordering Rationale

Identity and durable messaging precede scheduling; task/lease precedes safe parallel file work; broadcast depends on session registry + persistence; harness and safety close the autonomy story without assuming a daemon.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (MCP SDK, zod, Node, logging) | **HIGH** | Official SDK + npm-verified versions |
| Features (table stakes) | **MEDIUM–HIGH** | Strong alignment with `PROJECT.md`; industry patterns MEDIUM |
| Architecture (Streamable HTTP hub) | **HIGH** on spec; **MEDIUM** on Cursor client behavior |
| Pitfalls (Cursor limits, Continue) | **MEDIUM** | Many from community — re-verify per build |

**Overall confidence:** **MEDIUM**

### Gaps to Address

- Reconcile **file-first** vs **SQLite-first** persistence in the first implementation milestone.
- Record **Cursor + MCP config** used for CI/smoke tests.
- Validate **SSE vs poll** before locking UX for “listen.”

---

## Sources

### Primary (HIGH confidence)

- [MCP Specification 2025-11-25 — Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP Transports — 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (Streamable HTTP, sessions)
- [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- npm registry (`npm view`) for package versions — `STACK.md`

### Secondary (MEDIUM confidence)

- `.planning/PROJECT.md` — scope and constraints for gsd-2
- Industry / blog patterns for multi-agent orchestration — vocabulary only
- Cursor changelog / long-running agents docs — product split vs IDE MCP

### Tertiary (LOW–MEDIUM — validate before production)

- Cursor forum reports on tool count (~40) and MCP quirks
- Third-party client issues (reconnect, multi-instance) — pattern risk

---

*Research synthesized: 2026-04-07*  
*Inputs: `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`*  
*Ready for roadmap: yes*
