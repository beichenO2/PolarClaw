# Project State (SSOT)

Last Updated: 2026-03-04 (S0+S1 verified)
Source of Truth: state.md is authoritative.
Conflict Rule:
- If other docs conflict with state.md, follow state.md.
- Propose patches to bring other docs in sync. Do not "average" conflicts.

## Project
Name: Personal Local Agent Cloud (Single Machine)
Goal (v1): A local "cloud-like" agent system on ONE machine with WebUI entry.

## Current Slice
Slice: S1 DONE -> S2 NOT STARTED

- S0: WebUI <-> Backend health check loop [DONE - verified 2026-03-04]
- S1: WebUI -> Backend -> LLMProvider (EchoProvider stub) -> WebUI [DONE - verified 2026-03-04]

Non-goals (for S0/S1):
- No session management (multi-turn context)
- No memory (write/retrieve/compress)
- No tools/skills/MCP
- No auth / multi-user
- No distributed deployment

## Architecture (high level)
Layers:
- Entry: WebUI
- Service: Backend API
- Core: LLM Provider abstraction (local runtime)
Later:
- Tools: Skills + MCP
- Memory: write / retrieve / compress

Data flow (S1):
WebUI -> POST /chat -> LLMProvider.generate() -> response -> WebUI

## Tech choices
Frontend: Vite + React (decided; single-page, no SSR needed for S0/S1)
Backend: FastAPI + uvicorn (decided)
LLM runtime: TBD (ollama / llama.cpp / vLLM); S1 uses EchoProvider stub
Storage: local filesystem (for now)

## Repo Layout
- frontend/   (Vite + React; src/App.jsx — health check + chat UI)
- backend/    (FastAPI; main.py + llm_provider.py + requirements.txt)
- docs/

## Run Targets
Backend:
- Port: 8000
- Command: cd backend && source .venv/bin/activate && uvicorn main:app --port 8000
- Health: GET /health -> {"status":"ok"}
Frontend:
- Port: 3000
- Command: cd frontend && npm run dev
- Calls backend base URL: http://localhost:8000

## Acceptance Tests
S0:
- [x] Backend /health returns {"status":"ok"}
- [x] WebUI shows backend health "ok" (or equivalent)
S1:
- [x] WebUI sends a message and receives model text
- [x] Backend handles timeouts/errors gracefully (user sees a clear error)
S2:
- [ ] Session create / switch / list via API
- [ ] Sessions persisted to local filesystem
