# PolarClaw — Architecture & Interface Contracts

## Identity

**PolarClaw is an interactive hub**, not an autonomous guardian.

- Provides multi-channel interaction (Feishu, CLI, Web)
- Runs ReAct agent loop with LLM tool-calling
- Manages user personas, memory, proactive care
- Hosts YOLO self-execution mode
- **Does NOT execute Pilot Runtime logic** — all pilot operations are delegated to PolarPilot via contract

## Sandbox Boundary

PolarClaw's sandbox contains two zones:

| Zone | Contents | Examples |
|------|----------|---------|
| **Sandbox-internal** (interactive) | User-facing capabilities | Feishu adapter, CLI adapter, Web dashboard, ReAct agent, CareEngine, YOLO engine, Skill registry |
| **Sandbox-external** (IO layer) | Contract-based proxies to external services | PolarPilot contract client, SOTAgent event bus (via PolarPilot), PolarPrivate LLM proxy |

**Explicitly excluded** from PolarClaw sandbox:
- Pilot Runtime state machine (FindTarget → DrawBoard → Shoot → MoveBoard)
- Target tree filesystem management
- Daemon/guardian process logic
- Direct SQLite access for approvals (delegated to PolarPilot)

## PolarPilot Contract

PolarClaw communicates with PolarPilot exclusively through HTTP contract endpoints.
Contract schemas are defined in `contracts/polarpilot-*.schema.json`.

### Endpoint Summary

| Capability | PolarClaw role | PolarPilot role | Contract |
|------------|---------------|-----------------|----------|
| Lobster status | Query & display | Compute from runtime state | `polarpilot-status` |
| Target CRUD | Proxy via SDK API | Filesystem + validation | `polarpilot-targets` |
| Event emit/query | Forward to PolarPilot | Dual-channel (SOTAgent + local file) + dedup | `polarpilot-events` |
| Approval lifecycle | Proxy via SDK API | SQLite persistence + expiry | `polarpilot-approvals` |
| Health check | Display | Report uptime + monitored projects | `polarpilot-status` |

### Configuration

PolarClaw connects to PolarPilot via:
```
POLARPILOT_URL=http://127.0.0.1:4900
```

### Failure Mode

When PolarPilot is unreachable:
- SDK methods throw `PolarPilotError` with descriptive message
- Web API routes return HTTP 502
- PolarClaw interactive capabilities (Feishu, CLI, ReAct, YOLO) remain functional

## Other Dependencies

| Service | Interface | Purpose |
|---------|-----------|---------|
| PolarPrivate | HTTP proxy | LLM API routing, Feishu user identity resolution |
| SOTAgent | Via PolarPilot contract | Lobster event bus (PolarClaw does not call SOTAgent directly) |
| Clock | SSE + HTTP | Timer events, schedule-driven proactive care |
| port-sdk | HTTP | Dynamic port registration |
