# Decisions Log (Append-only)

Rules:
- Append new entries only. Do not rewrite old entries.
- Each decision should be small, explicit, and reversible where possible.

## 2026-03-03
- D001: Start with single-machine deployment only to reduce complexity.
- D002: Use vertical slices (S0..S5) and require acceptance tests at each slice.
- D003: WebUI is the entry point for v1; chat is the first feature.
- D004: Contract-first: interfaces.md defines API shape; code must follow.

## 2026-03-04
- D005: Frontend → Vite + React (chosen over Next.js; no SSR needed at S0/S1, simpler local dev setup).
- D006: Backend → FastAPI + uvicorn (confirmed from "recommended" to decided; aligned with requirements.txt).
- D007: CORS allow-origin set to http://localhost:3000 only (no wildcard; minimal surface for local dev).

## 2026-03-04 (S1)
- D008: LLMProvider interface is a plain Python class (generate(message, params) -> str); EchoProvider is the S1 stub. Real provider swapped in later without touching endpoints.
- D009: POST /chat error handling: all provider exceptions caught in endpoint and returned as {"error":{"code":"internal_error","message":"..."}} with HTTP 500; no leaking of raw stack traces.