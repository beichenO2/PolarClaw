# Domain Pitfalls: MCP-Based Autonomous Multi-Agent Collaboration (gsd-2)

**Domain:** Peer-to-peer, MCP-mediated collaboration among multiple Cursor Agents  
**Researched:** 2026-04-07  
**Overall confidence:** **MEDIUM** — MCP/Cursor behavior is partly documented; some limits come from community reports and should be re-verified against your Cursor build before locking architecture.

## Scope

These pitfalls target **gsd-2** specifically: TypeScript MCP server as hub, broadcast coordination, `.planning/` as shared state, **no long-lived agent process inside Cursor** (per `PROJECT.md`), and autonomy requirements (continue, concurrency, context limits).

---

## Phase map (for roadmap placement)

Use these labels consistently when scheduling work:

| Phase label | Typical contents |
|-------------|------------------|
| **P1 — MCP core** | Transport choice, process model, tool surface, error codes |
| **P2 — Protocol** | Broadcast semantics, message schema, ordering guarantees |
| **P3 — Shared state** | `.planning/` layout, leases, atomic writes, git policy |
| **P4 — Agent harness** | Continue loop, checkpoints, context refresh, handoff |
| **P5 — Safety** | Cost/iteration caps, loop detection, completion verification |
| **P6 — Hardening** | Crash recovery, observability, runbooks |

---

## 1. MCP + Cursor: stdio, tool budget, and client behavior

### What goes wrong

- **stdio is a single stream per server process.** The ecosystem pattern is *one* JSON-RPC conversation over stdin/stdout per spawned MCP server. Horizontal “many clients on one stdio” is not the model; scaling often means **SSE/streamable HTTP** or **multiple processes**, each with its own transport.
- **Cursor aggregates MCP tools into the model context.** Community reports describe a **hard practical ceiling** (often cited as ~40 tools total across all servers) beyond which tools may be omitted or behavior degrades—because every tool definition competes for tokens and decision latency. *Re-verify the exact number on your Cursor version; treat “tool budget” as real either way.*
- **Multiple MCP servers / instances:** Clients (including Cursor) have had bugs where **multiple instances of the same server** do not isolate correctly—both point at one process. That breaks “one server per agent” fantasies unless you use **distinct commands/ports** and verify behavior.
- **stdio + subprocess fragility:** SDKs have seen issues (e.g. stdio lifecycle around process exit) where handles close unexpectedly; any uncaught exception in the server can kill the whole tool surface for every chat in that workspace.

### Warning signs

- Agents “lose” tools mid-session; MCP calls fail with connection closed; only a subset of tools visible after adding servers.
- Intermittent `ECONNRESET` / broken pipe / silent MCP failure after heavy tool use.
- Two configured logical servers behaving identically (wrong host, wrong project path).

### Prevention strategy

- **Minimize tool count:** Prefer a **small** gsd-2 surface (e.g. `send_event`, `claim_task`, `release_task`, `get_inbox`, `append_planning`) and implement domain operations *inside* the server—not dozens of thin tools. Community “hub” patterns collapse many tools into `list` + `call` at the cost of weaker schemas in the LLM—trade off explicitly in P1/P2.
- **Choose transport deliberately:** If multiple IDE instances or future non-stdio clients must attach to **one** coordination service, plan **HTTP/SSE/WebSocket** for the hub *early* (P1), even if v1 ships stdio for simplicity—document migration.
- **Idempotent server startup:** One clear command line, deterministic cwd/env, crash-only logs; never rely on undefined order of MCP init across Cursor restarts.
- **Validate Cursor build:** Record in repo which Cursor version + MCP config was tested; add a smoke test checklist (tools discoverable, round-trip ping).

### Phases

- **P1** (must): Tool budget, transport choice, single vs multi-process story, smoke tests.
- **P6**: Regression tests when upgrading Cursor.

---

## 2. Agent autonomy: infinite loops, runaway cost, hallucinated completion

### What goes wrong

- **Micro-loops:** Same tool, same args, same error (e.g. failing test, permission denied) until budget exhaustion.
- **“Done” without proof:** Model marks work complete when tests did not run, or the wrong file changed—especially bad when **no human is watching**.
- **Cost explosions:** Documented agent failures include thousands of iterations and order-of-magnitude cost overruns when guardrails are absent.

### Warning signs

- Repeated identical or near-identical MCP payloads in logs; same file churn without diff net progress; monotonic token usage with flat task state.
- Completion messages that **do not** reference artifact IDs (commit hash, test log path, verification record) that your protocol requires.

### Prevention strategy

- **Hard caps:** `max_tool_calls_per_task`, `max_wall_time`, `max_cost_per_task` (enforced in MCP server or sidecar, not “prompt only”).
- **Progress signals:** Require **external** state transitions (e.g. task status in a file or DB table updated only after verification) before `COMPLETE` is legal.
- **Loop detection:** Hash recent tool-call sequences; identical failure N times → **escalate** (blocked task, different strategy, human slot if configured).
- **Verification-first:** GSD-style phases help—treat “execute” and “verify” as **separate** state machines; never let the same agent declare both without crossing a verification gate.

### Phases

- **P5** (core): Policies, detectors, escalation paths.
- **P4**: Harness must surface cap breaches as structured MCP errors, not silent stops.

---

## 3. Concurrency: git conflicts, file corruption, races

### What goes wrong

- Two agents edit the same file or the same JSON line → **lost updates**, invalid JSON, or merge conflicts that nobody resolves because the user is away.
- **Read-modify-write** on `.planning/*.md` without atomicity → torn writes.
- **Git** as coordination without rules → endless rebase/merge conflicts; agents “fix” by force-overwriting peer work.

### Warning signs

- Frequent `<<<<<<<` in tracked files; JSON parse errors in state files; last-writer-wins visible in event ordering.
- Two tasks claiming the same task id in overlapping windows.

### Prevention strategy

- **Ownership rules:** File-level or directory-level **leases** granted only via MCP (short TTL, heartbeat). No direct edits to leased paths from other agents.
- **Atomic writes:** Write temp + `rename`; optional fsync for critical indices; append-only **event log** + derived snapshots to reduce write contention.
- **Branching policy:** Task branches (`task/123-...`) or explicit **serialization** of write-heavy work—broadcast is for **events**, not for uncontrolled parallel edits to the same artifact.
- **Conflict detection:** Pre-commit hooks or MCP `git status` checks before declaring done; block completion if working tree is dirty with conflict markers.

### Phases

- **P3** (must): Lease + file layout + git rules.
- **P2**: Message semantics must not imply “everyone may edit everything.”

---

## 4. Context window exhaustion (long-running work)

### What goes wrong

- Early decisions (constraints, interfaces, error codes) live only in chat and are **forgotten** after summarization or long sessions.
- Agents re-derive wrong architecture because the **ground truth** was never externalized to durable artifacts.

### Warning signs

- Later tool calls contradict earlier ones; “rediscovering” already-solved subproblems; shrinking attention to checklist items at end of long threads.

### Prevention strategy

- **Single source of truth outside the window:** `PROJECT.md`, phase plans, decision logs, machine-readable task state—**mandatory** references the model must re-read at loop boundaries.
- **Structured checkpoints:** After N steps or M tokens, force **reload protocol**: re-read index files + current task + open risks (fits Cursor’s own long-horizon direction: plan persistence + multi-agent review, but **you** implement the files/MCP contract).
- **Chunk work:** Smaller tasks with explicit inputs/outputs reduce how much history must stay “hot.”

### Phases

- **P3–P4**: Checkpoint format, which files are authoritative, refresh cadence.

---

## 5. The “continue” problem — why Cursor agents stop, and what gsd-2 can do

### Why agents stop (Cursor-specific)

1. **Turn-based chat model:** The interactive Agent is fundamentally driven by **turns**. When the model returns without scheduling more work, or hits internal limits, the session **stalls** until something injects a new turn (user message, system continuation, or product feature).
2. **Product split:** Cursor’s **long-running agents** (hosted flow at cursor.com/agents, Ultra/Teams/Enterprise—see [Long-running agents changelog](https://www.cursor.com/changelog/02-12-26)) use a **custom harness** (planning, approval, multiple agents checking work). That is **not** the same as “my MCP server in the IDE chats forever.” gsd-2 cannot assume that harness unless you explicitly target that product surface.
3. **PROJECT.md constraint:** *“Cursor Agent 本身不是后台服务”* — you **must not** assume a daemon inside the IDE; continuation is **policy + artifacts + prompts**, possibly plus external schedulers or reminders—not a magical background thread in every Composer session.
4. **Stopping conditions:** Models stop when they believe the objective is met, when blocked, when confused, or when **tool failure** makes forward progress unclear—often **without** writing a durable “BLOCKED” state unless you force it.

### Deep mitigation (actionable for gsd-2)

| Approach | Role in gsd-2 |
|----------|----------------|
| **Durable plan + task queue** | MCP exposes “next action”; agent ends turn only after updating shared state so **another** agent or the **same** user session can pick up from files. |
| **Explicit CONTINUE contract** | Define a machine-readable `NEXT_STEPS` block (or task id) that any agent must read before acting; empty `NEXT_STEPS` = idle, not done. |
| **Human or alternate session** | Accept that true 24/7 may require **multiple** chat sessions or **hosted** agents; design for **handoff**, not infinite single-thread chat. |
| **Ralph-style forgetting** | Community pattern: **deliberately** drop old chat, keep repo state—periodic new session that reads only disk. Fits gsd-2 if checkpoints are excellent. |
| **Hooks / automation outside Cursor** | Optional: CLI or small process that opens work items (still not “the model running forever,” but **something** injects work). |

### Warning signs

- Agents end with “Let me know if you need anything else”; tasks stuck `IN_PROGRESS` with no lease heartbeat; repeated user nudges “continue.”

### Prevention strategy

- **Never tie liveness to chat length.** Tie it to **MCP-visible task state** + leases + heartbeat timeouts.
- **Document the continuation path** in one page: what file(s) to open, what MCP tool to call first—so a **new** Composer session is equivalent to continuing the old one.

### Phases

- **P4** (central): Harness spec, checkpoint files, CONTINUE semantics, handoff between sessions.
- **P2**: Events must support “work still pending” vs “idle.”

---

## 6. Token cost explosion with parallel agents

### What goes wrong

- **N agents × (system + tools + repo context)** — even idle agents may reload large contexts if users keep Composer windows open.
- **Broadcast chatter:** Every event duplicated into every session if naively mirrored into prompts → **O(N²)** narrative noise.
- **Tool definitions** repeated per session (MCP design)—already a Cursor concern with many tools.

### Warning signs

- Linear cost growth with number of open agent windows; rising latency before first tool call; duplicated narrative in logs.

### Prevention strategy

- **Event fan-in with summarization:** Agents subscribe to **summaries** or **diffs**, not full peer transcripts. Use sequence numbers and “since cursor” APIs in MCP.
- **Role specialization:** Reduce per-agent context (narrow branch, narrow folder).
- **Budgets per role:** e.g. researcher vs executor token caps.

### Phases

- **P2** (protocol shape), **P5** (enforcement).

---

## 7. State consistency for `.planning/` (multi-reader / multi-writer)

### What goes wrong

- **Split brain:** Two agents read `ROADMAP.md`, both plan next phase number, both write—duplicate phase ids.
- **Partial writes** mid-crash → corrupted JSON/YAML frontmatter.
- **Optimistic UI in the model:** The LLM “thinks” it wrote a file because it issued `write` in session A while session B overwrote.

### Warning signs

- Duplicate keys, non-monotonic version fields, “last line wins” in markdown tables; CI or scripts detecting invalid structure.

### Prevention strategy

- **Authoritative index:** Single `state.json` (or sqlite) **owned** by MCP mutations; markdown files are **rendered views** or regenerated, not manually merged by multiple agents.
- **Version counters:** Every mutation increments `planning_version`; readers discard stale reads.
- **Single writer principle:** Only one codepath (MCP tool implementation) may mutate critical indices; humans/agents call tools, not ad-hoc edit scripts—except through those tools.

### Phases

- **P3** (must): Storage model + migration from freeform md if needed.

---

## 8. MCP server reliability: crash mid-operation

### What goes wrong

- Server throws on bad input → process dies → **all** tools unavailable until restart.
- Client **may not auto-reconnect** cleanly (reports across MCP clients about reconnect gaps); in-flight request returns error or hangs depending on client.
- **At-least-once** retries can duplicate side effects if tools are not idempotent.

### Warning signs

- Spikes of JSON parse errors before crash; “Not connected” logs; stuck `PENDING` operations forever.

### Prevention strategy

- **Idempotent tools:** `claim_task` with idempotency keys; dedupe on server.
- **Crash-safe journaling:** Log intent to durable store **before** irreversible external effects.
- **Bounded input validation:** Never `throw` uncaught on malformed JSON—return JSON-RPC error.
- **Recovery semantics:** On restart, reload journal; reconcile in-flight operations; expose `recover_state` or equivalent for agents to poll.
- **Operator playbook:** Single command to restart server; documented Cursor reload path.

### Phases

- **P1** (error handling), **P6** (recovery drills).

---

## Cross-cutting: broadcast vs truth

**Pitfall:** Treating every broadcast message as authoritative. **Prevention:** Distinguish **facts** (versioned state in store) from **opinions** (chat-like events). Agents reconcile with the store, not with each other’s prose.

---

## Sources and confidence

| Claim | Confidence | Source |
|-------|------------|--------|
| Long-running agents use custom harness; hosted product | HIGH | [Cursor changelog Feb 12, 2026](https://www.cursor.com/changelog/02-12-26), [Long-running agents blog](https://www.cursor.com/blog/long-running-agents) |
| stdio MCP is local single-process pattern; HTTP/SSE for multi-client scaling | MEDIUM–HIGH | Ecosystem architecture articles + MCP transport discussions |
| Cursor MCP tool count pressure / ~40 tools | MEDIUM | Cursor community forum (exact limit changes—verify in product) |
| Multiple stdio MCP servers problematic in some clients | MEDIUM | e.g. Claude Code issue #21341 (pattern risk, not necessarily Cursor) |
| MCP client reconnect gaps | MEDIUM | e.g. OpenAI Codex issue #11489 (general MCP client behavior) |
| Loop/cost guardrails patterns | MEDIUM | Industry patterns (loop detection, caps)—not Cursor-specific |

**Re-verify before production:** Cursor MCP limits, transport support (`streamableHttp` vs stdio), and multi-window behavior on your OS and Cursor version.

---

## Quick lookup: pitfall → phase

| # | Pitfall | Primary phase |
|---|---------|----------------|
| 1 | MCP stdio/tool limits/stability | P1, P6 |
| 2 | Loops, cost, fake “done” | P5 |
| 3 | Concurrent edits / git | P2, P3 |
| 4 | Context loss | P3, P4 |
| 5 | Continue / handoff | P4 |
| 6 | Token explosion (N agents) | P2, P5 |
| 7 | `.planning/` consistency | P3 |
| 8 | Server crash / idempotency | P1, P6 |
