# Decisions Log (Append-only)

Rules:
- Append new entries only. Do not rewrite old entries.
- Each decision should be small, explicit, and reversible where possible.

---

## Inherited from Legacy Project (2026-03-04)

- D001: Single-machine deployment only (reduce complexity)
- D002: Vertical slices with acceptance tests at each slice
- D003: WebUI is the entry point; chat is the first feature
- D004: Contract-first: interfaces.md defines API shape; code must follow
- D005: Frontend → Vite + React
- D006: Backend → FastAPI + uvicorn
- D007: CORS allow-origin: http://localhost:3000 only
- D008: LLMProvider interface: generate(message, params) -> str; EchoProvider for stub
- D009: POST /chat error: normalized {"error":{"code":"...","message":"..."}} with HTTP 500

---

## 2026-03-18 (CLAW Baseline v0.1)

- D010: Introduce SSOT/ directory as canonical project fact source (replacing docs/)
- D011: Introduce Sprompt/ as prompt/spec source code library (static specs, not runtime)
- D012: Runtime objects stored as JSON files under runtime/tasks/{task_id}/
- D013: PromptAssembler reads from Sprompt/prompts/roles/ and compiles context-injected prompt packs
- D014: ModelGateway abstraction with two concrete providers: QwenProvider (DashScope-compatible OpenAI API), EchoProvider (stub)
- D015: AliCompatProvider is a skeleton only (Ali_API_KEY missing); wired but not functional
- D016: Qwen API accessed via OpenAI-compatible endpoint (DashScope), model=qwen-plus
- D017: ValidatorEngine baseline: checks required fields, whitelist presence, result format — not full deterministic evidence-based validation (full spec in Sprompt/operational/03_validator_spec.md, phased in later)
- D018: Files that are no longer active must be moved to /Users/mac/Desktop/ClawBin — never deleted
- D019: GitHub sync is a required engineering habit: commit frequently, push at milestones
- D020: Web UI redesigned as CLAW Console (not a simple chat page)
- D021: Backend module structure: api/, orchestrator/, prompt_runtime/, runtime_store/, model_gateway/, validator/, ssot_reader/
- D022: ModelProvider interface upgraded to messages-list format (OpenAI-compatible) from single-string format
D022: Qwen_Pro_API_KEY (len=38) causes 401 on DashScope - likely wrong format or needs DASHSCOPE_API_KEY env var name. System auto-falls back to EchoProvider. Key needs reconfiguration.
