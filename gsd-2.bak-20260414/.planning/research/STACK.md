# Technology Stack — MCP Multi-Agent Hub (gsd-2)

**Project:** gsd-2  
**Researched:** 2026-04-07  
**Scope:** TypeScript/Node.js stack for an MCP server that acts as a **communication hub** for multiple independent Cursor IDE agents (broadcast coordination, task distribution, state sync).

**Verification:** Package versions from `npm view <pkg> version` on 2026-04-07. Transport rules from [MCP spec 2025-11-25 — Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

---

## Executive recommendation

| Layer | Choice | Version (verified) | Confidence |
|-------|--------|--------------------|------------|
| MCP implementation | `@modelcontextprotocol/sdk` | **1.29.0** | **HIGH** |
| Schema / tool I/O validation | `zod` | **4.3.6** (peer: `^3.25 \|\| ^4.0`) | **HIGH** |
| JSON Schema (SDK peer) | `@cfworker/json-schema` | **^4.1.1** (range from SDK peer deps) | **HIGH** |
| Runtime | Node.js | **22.x LTS** (or **20.x LTS**); avoid <18 | **HIGH** |
| Primary transport (Cursor) | **stdio** + optional **Streamable HTTP** for multi-session hub | Spec: clients SHOULD support stdio | **HIGH** |
| Durable coordination store | **SQLite** via `better-sqlite3` + **Drizzle ORM** | **12.8.0** / **0.45.2** | **MEDIUM–HIGH** |
| Optional queue / fan-out | **BullMQ** + **ioredis** + Redis | **5.73.0** / **5.10.1** | **MEDIUM** |
| Postgres-first alternative queue | **pg-boss** | **12.15.0** | **MEDIUM** |
| File system watching | `chokidar` | **5.0.0** | **HIGH** |
| Structured logging | `pino` | **10.3.1** | **HIGH** |
| Dev runner | `tsx` | **4.21.0** | **HIGH** |
| Tests | `vitest` | **4.1.2** | **HIGH** |
| Correlation / task IDs | `nanoid` | **5.1.7** | **MEDIUM** |

---

## 1. MCP SDK (`@modelcontextprotocol/sdk`)

**Pin:** `@modelcontextprotocol/sdk@1.29.0`  
**Peers (from npm):** `zod` `^3.25 || ^4.0`, `@cfworker/json-schema` `^4.1.1`

**Why**

- Official implementation for MCP servers and clients in TypeScript; aligns with Cursor and other MCP hosts.
- Brings in battle-tested HTTP/SSE plumbing for **Streamable HTTP** (`express`, `hono`, `eventsource`, etc. as dependencies of the SDK — use them *via* the SDK rather than reinventing wire format).

**What NOT to do**

- Do **not** pin pre-release **v2** (`@modelcontextprotocol/server@2.x` alpha) for production until the project declares v2 stable; track releases and migrate when v2 GA + migration guide is clear (**LOW confidence** on exact GA date — verify at ship time).

**Confidence:** **HIGH**

---

## 2. Transports: stdio vs Streamable HTTP vs legacy SSE vs WebSocket

### 2.1 What the 2025 spec actually defines

Per [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), there are **two** standard transports:

1. **stdio** — client launches server as subprocess; JSON-RPC over stdin/stdout; stderr for logs.
2. **Streamable HTTP** — standalone HTTP server; POST/GET to one MCP endpoint; **optional SSE** for streaming server messages; session via `MCP-Session-Id`; replaces deprecated **HTTP+SSE** from 2024-11-05.

**Custom transports** are allowed (e.g. WebSocket) but MUST preserve JSON-RPC + lifecycle; interoperability with Cursor is on you.

### 2.2 Cursor IDE — practical guidance

- **stdio** is the default, lowest-friction path for local servers (`command` + `args` in MCP config). Spec says clients **SHOULD** support stdio whenever possible.
- **Streamable HTTP** (`streamableHttp` / URL-based) fits a **long-lived** hub process and multiple client sessions — closer to “one server, many agents” **if** every Cursor instance is configured to talk to the **same** endpoint (each session is separate; your hub logic must merge/broadcast).

**Critical architecture point for gsd-2:** With **stdio**, each MCP config typically spawns **its own** server process per connection model. Processes do **not** share memory — the “hub” must use a **shared store** (SQLite, Redis, files with proper locking) or you run **one** Streamable HTTP server and point clients at it.

**Why not “SSE” alone?** The old standalone HTTP+SSE transport is **deprecated**; new work should be **Streamable HTTP** (which may use SSE *inside* the HTTP model). Do not implement the legacy 2024-11-05 HTTP+SSE pattern for new code.

**Why not WebSocket as the MCP transport?** Not a standard MCP transport. Cursor’s documented integrations center on stdio and HTTP-based MCP. Using WebSocket means a **custom** transport — possible for auxiliary channels (e.g. internal UI), but **not** a substitute for MCP’s JSON-RPC lifecycle on supported transports.

| Transport | Use for gsd-2 | Avoid when |
|-----------|----------------|------------|
| **stdio** | Default; each Cursor agent talks to MCP tools; pair with **shared DB/Redis** for broadcast | You assume one process equals global hub state |
| **Streamable HTTP** | Single hub process, localhost binding + auth + Origin checks per spec | You cannot secure localhost / headers (DNS rebinding risk) |
| **Legacy HTTP+SSE** | — | New implementations |
| **WebSocket (custom)** | Only secondary tooling, not primary Cursor MCP | You need Cursor compatibility without extra work |

**Confidence:** **HIGH** (spec); **MEDIUM** (Cursor UI labels and exact multi-window behavior — validate in Cursor with your target version).

---

## 3. State & persistence

### 3.1 Boundary validation — `zod` + JSON Schema

- **`zod@4.3.6`** — validate tool inputs/outputs, config, and persisted rows at boundaries. Matches MCP SDK peer range.
- **`@cfworker/json-schema`** — satisfy SDK peer dependency; use where JSON Schema interop matters.

**Confidence:** **HIGH**

### 3.2 Durable hub state — SQLite + Drizzle

**Pin:** `better-sqlite3@12.8.0`, `drizzle-orm@0.45.2`

**Why**

- Hub needs **ACID** semantics for tasks, locks, and idempotency when multiple agents race.
- SQLite is a single-file operational story ideal for a repo-local or sidecar hub; **WAL** mode supports concurrent readers with serialized writers — still serialize writes in code for hot paths.
- Drizzle gives typed queries and migrations without a heavy ORM.

**Postgres** is a natural upgrade path if the hub moves off a single machine; Drizzle migrates with you.

**What NOT to use as the only layer**

- Raw JSON files for **task queue** state under heavy concurrency — use DB or a real queue (below).

**Confidence:** **MEDIUM–HIGH** (pattern); **HIGH** on library maturity.

### 3.3 In-process vs cross-cutting “state management”

- **Not** Redux/Zustand — those target UI; the hub is a **server**. Use **repository modules** + Drizzle + small domain services.
- Optional: **`effect@3.21.0`** for typed concurrency and resource safety — powerful but adds team learning curve; defer unless you already standardize on Effect.

**Confidence:** **HIGH**

---

## 4. Task queues & work distribution

### 4.1 Redis + BullMQ (default for rich semantics)

**Pin:** `bullmq@5.73.0`, `ioredis@5.10.1`, Redis **7.x** (runtime outside npm)

**Why**

- Priorities, delayed jobs, retries, rate limits, and **multiple worker** processes map cleanly to “many agents pulling work.”
- De facto standard for Node job queues in 2025–2026 ecosystems.

**Cost:** Operational Redis (local Docker or managed).

**Confidence:** **MEDIUM** — **HIGH** on library quality; **MEDIUM** on whether you need full Redis vs SQLite-only for v1.

### 4.2 PostgreSQL + pg-boss (no Redis)

**Pin:** `pg-boss@12.15.0`

**Why**

- If you already run Postgres, **SKIP LOCKED**-style semantics and ACID reduce moving parts versus Redis.
- Weaker story than BullMQ for very advanced flow graphs — still solid for task queues.

**Confidence:** **MEDIUM**

### 4.3 What NOT to use

- **`bull`** (legacy predecessor to BullMQ) — use **BullMQ** for new code.
- **In-memory-only queues** for autonomous multi-agent production paths — acceptable only for tests or single-process demos.

---

## 5. File system watching

**Pin:** `chokidar@5.0.0`

**Why**

- Cross-platform, de facto standard for watching workspace changes; used across the ecosystem for dev tooling and file-driven workflows.

**What NOT to use**

- Ad hoc `fs.watch` without normalization — inconsistent on macOS/Linux for editor save patterns.

**Confidence:** **HIGH**

---

## 6. Observability & hygiene

| Library | Version | Role |
|---------|---------|------|
| `pino` | 10.3.1 | Structured JSON logs; stderr policy for stdio servers |
| `nanoid` | 5.1.7 | Short IDs for tasks/events |
| `vitest` | 4.1.2 | Unit/integration tests for tools and hub logic |
| `tsx` | 4.21.0 | Dev execution of TypeScript |

**stdio note:** MCP requires stdout to be **only** MCP messages — log to **stderr** (pino destination) or files.

**Confidence:** **HIGH**

---

## 7. Multi-agent frameworks (ecosystem context)

These are **not** drop-in replacements for your MCP hub, but they inform patterns:

- **LangGraph / LangChain**, **Microsoft Agent Framework**, **CrewAI**, etc. — often Python-centric or host-managed orchestration; useful for **research patterns** (handoff, reflection), not as the gsd-2 TypeScript MCP core.
- **mcp-agent** (third-party) — SDK/docs exist for MCP-centric agents; evaluate for ideas; gsd-2’s **peer broadcast + Cursor constraints** likely need a custom hub anyway (**MEDIUM** confidence — product surface changes quickly).

**Recommendation:** Build on **`@modelcontextprotocol/sdk`**, borrow orchestration **ideas** from multi-agent literature, do not assume a single npm package delivers “MCP + Cursor + peer broadcast” out of the box.

---

## 8. Installation sketch (pin in your repo)

```bash
npm install @modelcontextprotocol/sdk@1.29.0 zod@4.3.6 @cfworker/json-schema@^4.1.1
npm install better-sqlite3@12.8.0 drizzle-orm@0.45.2
npm install chokidar@5.0.0 pino@10.3.1 nanoid@5.1.7
# Optional queue path A:
npm install bullmq@5.73.0 ioredis@5.10.1
# Optional queue path B:
npm install pg-boss@12.15.0
npm install -D typescript vitest@4.1.2 tsx@4.21.0
```

---

## 9. Summary: what to use vs avoid

| Use | Avoid for this project |
|-----|-------------------------|
| `@modelcontextprotocol/sdk` 1.x | Hand-rolled JSON-RPC without SDK |
| stdio (+ shared store) or Streamable HTTP | Legacy HTTP+SSE transport for new code |
| Zod at I/O boundaries | Untyped `any` tool payloads |
| SQLite + Drizzle for hub state | Files-only task ledger under concurrency |
| BullMQ **or** pg-boss for real queues | `bull` (old), memory-only queues in prod |
| chokidar | Raw `fs.watch` as primary |
| pino to stderr / file | `console.log` to stdout on stdio servers |
| WebSocket only as optional non-MCP side channel | WebSocket as the only MCP-facing transport |

---

## Sources

- [MCP Specification 2025-11-25 — Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) (**HIGH**)
- npm registry: `npm view` for versions listed (**HIGH**)
- [typescript-sdk repository](https://github.com/modelcontextprotocol/typescript-sdk) (**HIGH**)
- Cursor MCP configuration behavior: third-party guides only — validate in product (**MEDIUM**)

---

## Open points (validate at implementation time)

1. **Cursor** multi-window behavior when several chats use the **same** Streamable HTTP URL vs separate stdio processes — affects hub topology.
2. **MCP SDK v2** GA timeline and migration — re-check before locking major releases.
3. Whether **v1** hub can stay **SQLite-only** or needs **Redis** early for broadcast volume — profile with realistic agent counts.
