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
| **Sandbox-internal** (interactive) | User-facing capabilities | Feishu adapter, CLI adapter, Web dashboard, ReAct agent, CareEngine, YOLO engine, Skill registry, ComputerUse browser engine |
| **Sandbox-external** (IO layer) | Contract-based proxies to external services | PolarPilot contract client, SOTAgent event bus (via PolarPilot), PolarPrivate LLM proxy, **ComputerUse SDK** (other projects request browser automation here) |

ComputerUse intentionally lives on both sides of the boundary:
- the internal browser engine runs Chromium inside PolarClaw's container
- the external SDK surface (`/api/sdk/computer-use/*`) is the only entry point any other Polarisor project uses, so no other project ever ships a Chromium of its own.

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
| **ComputerUse** | **Own & serve** (Stagehand inside container) | n/a — not delegated to PolarPilot | `polarclaw-computer-use` (SDK-only) |

### ComputerUse SDK contract

ComputerUse is the one capability where PolarClaw is the *server* of the
SDK contract for the rest of the ecosystem; PolarPilot is not involved.

| HTTP route (POST) | Calling project header | Server-side method | Purpose |
|-------------------|-----------------------|--------------------|---------|
| `/api/sdk/computer-use/browse` | `X-PolarClaw-Project` | `sdk.computerUse.browse({url, action, screenshot?})` | Navigate + perform a natural-language action; returns action result, page url/title, optional screenshot path |
| `/api/sdk/computer-use/screenshot` | `X-PolarClaw-Project` | `sdk.computerUse.screenshot({url, full_page?, observe?, observe_timeout_ms?, analyze?, analyze_prompt?})` | Screenshot with optional `observe` (Stagehand accessibility tree via PolarPrivate text LLM) and optional `analyze` (local VLM for image understanding); `analysis` field returns VLM text description |
| `/api/sdk/computer-use/fill-form` | `X-PolarClaw-Project` | `sdk.computerUse.fillForm({url, fields, submit?})` | Fill form fields keyed by description, optionally submit |

Calling projects use the `polarclaw-project-sdk` thin client:
`sdk.computerUse.browse({...})` / `sdk.computerUse.screenshot({...})` /
`sdk.computerUse.fillForm({...})`. Failure semantics: the response body
always carries `{ ok: boolean, error?: string }`; HTTP 502 is returned
when `ok` is false, HTTP 500 only on unexpected exceptions.

LLM routing for the action / observe paths is configured via
`COMPUTER_USE_LLM_BASE_URL` / `COMPUTER_USE_LLM_API_KEY` /
`COMPUTER_USE_MODEL_NAME` env vars on the PolarClaw side. The default
points at the PolarPrivate `/v1` gateway so no project ever sees an
external LLM key.

VLM image analysis (the `analyze` option in `screenshot`) is served by a
local llama-server instance and configured via `COMPUTER_USE_VLM_URL`
(default `http://127.0.0.1:8080`) and `COMPUTER_USE_VLM_MODEL` (default
`gemma-3-27b-it`). llama-server runs as a launchd service
(`com.llama.server`) on Mac Studio, starts automatically at login, and
exposes an OpenAI-compatible `/v1/chat/completions` endpoint for multimodal
requests.

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
