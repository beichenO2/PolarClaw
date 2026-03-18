# CLAW System State (SSOT)

Last Updated: 2026-03-18 (Router baseline v0.1)
Source of Truth: This file is authoritative for project facts.  
Conflict Rule: If other docs conflict with state.md, follow state.md.

---

## System

Name: CLAW (Contextual Layered Agent Workbench)  
Goal (v1): 本地长期运行多层 Agent 系统，具备最小闭环执行能力，支持渐进式自进化。

## Current Milestone

**Router baseline v0.1 — COMPLETE (2026-03-18)**

系统已从单 task 直派升级为 task → Router → WorkItems → RouteGroups → Bot/Run 架构。

- [x] Sprompt/ 规范库建立完成（含 Router 层规范）
- [x] SSOT/ 文档体系建立（含 Router 接口契约）
- [x] Backend skeleton 实现（api/ orchestrator/ prompt_runtime/ runtime_store/ model_gateway/ validator/ ssot_reader/ **router/**）
- [x] Frontend CLAW Console 实现（Task/Run/Result/Validation/Evidence/**WorkItems/RouteGroups/RouterSummary** 面板）
- [x] Runtime store 实现（JSON 文件，新增 Router 相关文件）
- [x] PromptAssembler + ContextPacker 实现
- [x] ModelGateway 实现（QwenProvider + EchoProvider fallback + AliCompat skeleton）
- [x] Validator 实现（5 项基础检查 + 5 项 Router 检查）
- [x] **Router 实现：WorkItem 拆分（规则驱动）+ RouteGroup 组装（保守合并）**
- [x] **RouterDecision / RouterReviewResult / RouteGroupRuntime / RouteGroupResult 对象落地**
- [x] 最小闭环联调通过（task → normalize → **router** → routegroups → prompt → model → agent_result → validate → store → UI）
- [ ] GitHub 推送（待完成）
- [x] 三路 Provider 全部可用（CodingPlan / MiniMax / DashScope，经 source ~/.bashrc 后验证）
- [x] Task-type → model 精细路由落地（coding/router/agent/vision/debug/general）

## Architecture (Router baseline v0.1)

```
User / CLAW Console (port 3000)
  ↓
Backend API (port 8000)
  ↓
Orchestrator
  ├── normalize_task_input()  → task_contract
  ├── run_router()            → RouterDecision + WorkItems + RouteGroups
  ├── build_route_group_runtime()
  └── dispatch_route_groups() [serial baseline]
        ↓
        per-RouteGroup:
          PromptAssembler → ContextPacker → ModelGateway
          → agent_result → ValidatorEngine (base + router checks)
          → validation_report → RuntimeStore
  ↓
Frontend 展示（含 Router Summary / WorkItems / RouteGroups 面板）
```

## Router Layer Facts

- **Router 位于 CLAW 层与 Executor 层之间**（Layer 1.5）
- **WorkItem 拆分策略**：规则驱动，保守优先
  - 序号列表 / bullet / 分隔词 → 多 WorkItem
  - 不确定 → 1 WorkItem + warning
- **RouteGroup 组装策略**：保守隔离
  - 默认 1 WorkItem → 1 RouteGroup
  - mode/isolation/dependency/conflict 兼容时才合并
- **Bot 分配**：project_mode → ProjectMakerBot；knowledge_mode → KnowleverBot
- **RouteGroup 执行**：本轮串行，数据结构已支持未来并行

## Project Structure

```
PolarClaw/
  SSOT/               ← 系统事实源（本文件所在）
  Sprompt/            ← prompt/spec 规范库（含 Router 层规范）
  runtime/            ← 运行时对象存储
  backend/            ← FastAPI 后端（port 8000）
    api/
    orchestrator/
    prompt_runtime/
    runtime_store/
    model_gateway/
    validator/
    ssot_reader/
    router/           ← ★ 新增：Router 层（types/splitter/grouping/router）
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

| 变量名 | 用途 | Key 格式 |
|--------|------|---------|
| `Coding_Plan_API_KEY` | CodingPlanProvider，所有 Agent 对话主力 | `sk-sp-xxx` |
| `Minimax_Token_Plan_API_KEY` | MiniMaxProvider，视觉任务 + 多模型互补 debug | `sk-xxx` |
| `PolarClaw_DASHSCOPE_API_KEY` | QwenProvider，DashScope 按量，fallback 用 | `sk-xxx` |
| `Ali_API_KEY` | AliCompatProvider，skeleton only，MISSING | — |

**Security rule: Never output full key values in logs, docs, or code.**

## Provider 架构（2026-03-18 基准测试后更新）

基准测试结果（2026-03-18）：qwen3-coder-plus 1.8s / kimi-k2.5 2.4s / qwen-plus 2.9s / MiniMax-M2.7 5.6s / qwen3.5-plus 13s（已降级）

```
task_type="coding"  → CP / qwen3-coder-plus (~1.8s)  → DS / qwen-plus → Echo
task_type="router"  → CP / kimi-k2.5        (~2.4s)  → CP / qwen3-coder-plus → DS → Echo
task_type="agent"   → CP / kimi-k2.5        (~2.4s)  → CP / qwen3-coder-plus → DS → Echo
task_type="vision"  → MM / MiniMax-M2.7     (~5.6s)  → DS / qwen-plus → Echo
task_type="debug"   → MM / MiniMax-M2.7     (~5.6s)  → CP / kimi-k2.5 → DS → Echo
task_type="general" → DS / qwen-plus        (~2.9s)  → CP / qwen3-coder-plus → Echo
```

Orchestrator mode → task_type 映射：
```
project_mode   → "coding"   (qwen3-coder-plus)
knowledge_mode → "agent"    (kimi-k2.5)
debug_mode     → "debug"    (MiniMax-M2.7)
vision_mode    → "vision"   (MiniMax-M2.7)
```

**Multi-model debug 原则**: A 模型产生的结果由 B 模型（不同厂商）来 review，提供独立视角。  
**qwen3.5-plus 已降级**：基准测试延迟 ~13s，不再作为默认模型。

## Runtime Store

Location: `runtime/tasks/`  
Format: JSON files per task  
Structure:
```
runtime/tasks/{task_id}/
  task_contract.json
  status.json
  work_items.json                          ← ★ Router baseline
  route_groups.json                        ← ★ Router baseline
  router_decision.json                     ← ★ Router baseline
  router_review_result.json                ← ★ Router baseline
  route_group_runtime/{rg_id}.json         ← ★ Router baseline
  route_group_result/{rg_id}.json          ← ★ Router baseline
  runs/{run_id}/
    agent_result.json
    evidence_pack.json
    validation_report.json
```

## Acceptance Tests (Router baseline v0.1)

- [x] POST /api/tasks → returns task_id, status=processing
- [x] GET /api/tasks/{id} → returns current status
- [x] Single goal → 1 WorkItem, 1 RouteGroup
- [x] Numbered list (3 items) → 3 WorkItems, 1 merged RouteGroup (same mode)
- [x] RouterDecision saved to runtime store
- [x] RouterReviewResult saved to runtime store
- [x] RouteGroupRuntime saved to runtime store
- [x] validate_router returns PARTIAL (TBD warnings) or PASS
- [x] GET /api/tasks/{id}/result returns work_items + route_groups + router_decision
- [x] Frontend shows WorkItems / RouteGroups / Router Summary panels
- [x] EchoProvider fallback works
- [ ] QwenProvider real response (API key needs fix)

## Non-goals (Router baseline v0.1)

- No FSM implementation
- No true parallel RouteGroup execution (serial baseline)
- No real Human Action Gate (field reserved, not activated)
- No LLM-based WorkItem decomposition (rule-driven only)
- No database (JSON runtime store continues)

## ClawBin Policy

Files that are no longer active are moved to `/Users/mac/Desktop/ClawBin/`.  
Never delete project files — always archive.  
Archive record: see `SSOT/docOps.md`.
