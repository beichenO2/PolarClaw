# CLAW System State (SSOT)

Last Updated: 2026-03-18  
Source of Truth: This file is authoritative for project facts.  
Conflict Rule: If other docs conflict with state.md, follow state.md.

---

## System

Name: CLAW (Contextual Layered Agent Workbench)  
Goal (v1): 本地长期运行多层 Agent 系统，具备最小闭环执行能力，支持渐进式自进化。

## Current Milestone

**Baseline v0.1 — COMPLETE (2026-03-18)**

- [x] Sprompt/ 规范库建立完成
- [x] SSOT/ 文档体系建立
- [x] Backend skeleton 实现（api/ orchestrator/ prompt_runtime/ runtime_store/ model_gateway/ validator/ ssot_reader/）
- [x] Frontend CLAW Console 实现（Task/Run/Result/Validation/Evidence 面板）
- [x] Runtime store 实现（JSON 文件，runtime/tasks/{id}/runs/{id}/）
- [x] PromptAssembler + ContextPacker 实现（读取 Sprompt/，token budget 控制）
- [x] ModelGateway 实现（QwenProvider + EchoProvider fallback + AliCompat skeleton）
- [x] Validator skeleton 实现（5 项基础检查，PASS/FAIL/BLOCKED/NEED_HUMAN）
- [x] 最小闭环联调通过（task → normalize → prompt → model → agent_result → validate → store → UI）
- [ ] GitHub 推送（待完成）
- [ ] Qwen API key 修正（当前 key 401，系统 fallback 到 EchoProvider）

## Architecture (v0.1)

```
User / CLAW Console (port 3000)
  ↓
Backend API (port 8000)
  ↓
Orchestrator → PromptAssembler → ContextPacker
  ↓
ModelGateway (QwenProvider / EchoProvider)
  ↓
agent_result → ValidatorEngine
  ↓
validation_report → RuntimeStore
  ↓
Frontend 展示
```

## Project Structure

```
PolarClaw/
  SSOT/               ← 系统事实源（本文件所在）
  Sprompt/            ← prompt/spec 规范库
  runtime/            ← 运行时对象存储
  backend/            ← FastAPI 后端（port 8000）
    api/
    orchestrator/
    prompt_runtime/
    runtime_store/
    model_gateway/
    validator/
    ssot_reader/
    main.py
  frontend/           ← Vite+React 前端（port 3000）
  设计文档/            ← 架构参考文档
```

## Run Targets

Backend:
- Port: 8000
- Command: `cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 --reload`
- Health: `GET /health → {"status":"ok"}`

Frontend:
- Port: 3000
- Command: `cd frontend && npm run dev`
- Backend base URL: http://localhost:8000

## Environment Variables

- `Qwen_Pro_API_KEY`: required for QwenProvider (exists, len=38)
- `Ali_API_KEY`: required for AliCompatProvider (MISSING — provider skeleton only)

**Security rule: Never output full key values in logs, docs, or code.**

## Current Provider

Active: `QwenProvider` (if `Qwen_Pro_API_KEY` set) else fallback to `EchoProvider`

## Runtime Store

Location: `runtime/tasks/`  
Format: JSON files per task  
Structure:
```
runtime/tasks/{task_id}/
  task_contract.json
  runs/{run_id}/
    agent_result.json
    evidence_pack.json
    validation_report.json
```

## Acceptance Tests (Baseline v0.1)

- [ ] POST /api/tasks → returns task_id, status=processing
- [ ] GET /api/tasks/{id} → returns current status
- [ ] Task completes → agent_result saved
- [ ] validation_report generated
- [ ] Frontend shows run status + result + validation
- [ ] QwenProvider returns real model response
- [ ] EchoProvider fallback works

## Non-goals (v0.1)

- No complex FSM states
- No multi-agent concurrency
- No vector retrieval
- No full self-evolution
- No multi-user / auth

## ClawBin Policy

Files that are no longer active are moved to `/Users/mac/Desktop/ClawBin/`.  
Never delete project files — always archive.  
Archive record: see `SSOT/docOps.md`.
