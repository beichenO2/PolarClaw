# Roadmap / Backlog

## Done
- S0: Health check loop (WebUI <-> Backend) [verified 2026-03-04]
- S1: Single-turn LLM call via backend API (EchoProvider stub) [verified 2026-03-04]

## Now
- S2: Session management (create/switch/list sessions; persist)

## Next
- S3: Memory v1 (write + retrieve with RAG-like top-k injection)
- S4: Tools v1 (Skills) + later MCP integration
- S5: Memory v2 (compression + token budget control)

## Later / Parking Lot
- WebUI: better conversation management UI
- "Stop generation" / cancel request (requires backend cancellation support)
- Streaming tokens in WebUI
- Multi-user auth & access control
- Observability: logging, tracing, prompt/version tracking
