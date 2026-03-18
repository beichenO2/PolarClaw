# CLAW Interfaces (Contract)

Rule: This file is the API contract. Do NOT change request/response shapes in code unless you first update this file.

Last Updated: 2026-03-18 (Router baseline v0.1)

---

## HTTP API — Backend (port 8000)

### GET /health
Response 200:
```json
{ "status": "ok" }
```

### POST /api/tasks
**Purpose:** 创建新任务，启动后台处理流程（含 Router 阶段）

Request:
```json
{
  "goal": "string (required)",
  "mode": "knowledge_mode | project_mode | null (auto-detect)",
  "constraints": ["string"],
  "session_id": "string | null (auto-generated if null)"
}
```

Response 200:
```json
{
  "task_id": "uuid",
  "session_id": "string",
  "status": "processing",
  "mode": "knowledge_mode | project_mode",
  "created_at": "ISO8601"
}
```

Error (400/500):
```json
{ "error": { "code": "string", "message": "string" } }
```

### GET /api/tasks/{task_id}
**Purpose:** 查询任务状态

Response 200:
```json
{
  "task_id": "uuid",
  "status": "processing | done | failed | blocked | need_human",
  "mode": "string",
  "goal": "string",
  "run_id": "uuid | null",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### GET /api/tasks/{task_id}/result
**Purpose:** 获取任务执行结果（含 Router 层产物）

Response 200:
```json
{
  "task_id": "uuid",
  "run_id": "uuid | null",
  "all_run_ids": ["uuid"],
  "status": "string",
  "router_decision": "RouterDecision | null",
  "router_review_result": "RouterReviewResult | null",
  "work_items": ["WorkItem"],
  "route_groups": ["RouteGroup"],
  "route_group_runtimes": { "rg_id": "RouteGroupRuntime" },
  "agent_result": {
    "outputs": [{"output_type": "string", "description": "string"}],
    "model_response": "string",
    "fact_status": {
      "confirmed_facts": ["string"],
      "inferred_hypotheses": ["string"],
      "unknowns": ["string"]
    }
  },
  "validation_report": {
    "judgment": "PASS | FAIL | BLOCKED | NEED_HUMAN",
    "criteria_results": [],
    "violations": [],
    "summary": "string",
    "router_validation": {
      "work_items_valid": "boolean",
      "route_groups_valid": "boolean",
      "decision_traceable": "boolean",
      "judgment": "PASS | FAIL | PARTIAL"
    }
  },
  "human_actions": [],
  "blocked_reason": "string | null"
}
```

Response 404 (task not found or not yet done):
```json
{ "error": { "code": "not_ready", "message": "Task result not yet available" } }
```

### POST /chat (legacy, kept for backward compat)
Purpose: 单轮聊天（S1 legacy）

Request:
```json
{ "message": "string", "params": { "temperature": null, "max_tokens": null } }
```

Response 200:
```json
{ "text": "string", "meta": { "model": "string", "latency_ms": "number" } }
```

---

## Runtime Objects (Contract)

### WorkItem
```json
{
  "work_item_id": "uuid",
  "task_id": "uuid",
  "title": "string",
  "goal": "string",
  "constraints": ["string"],
  "context": {},
  "editable_whitelist": ["string"],
  "acceptance_criteria": [{"criterion_id": "string", "description": "string"}],
  "recommended_mode": "knowledge_mode | project_mode",
  "priority": "high | medium | low",
  "status": "pending | assigned | running | done | failed | blocked",
  "isolation_required": "boolean",
  "dependency_ids": ["work_item_id"],
  "conflict_ids": ["work_item_id"],
  "created_at": "ISO8601"
}
```

### RouteGroup
```json
{
  "route_group_id": "uuid",
  "task_id": "uuid",
  "work_item_ids": ["work_item_id"],
  "mode": "knowledge_mode | project_mode",
  "bot_name": "string | null",
  "fsm_name": "string | null",
  "priority": "high | medium | low",
  "status": "pending | running | done | failed | blocked",
  "editable_whitelist": ["string"],
  "blocking_reason": "string | null",
  "wait_gate_event": "string | null",
  "human_confirmation_required": "boolean",
  "created_at": "ISO8601"
}
```

### RouterDecision
```json
{
  "task_id": "uuid",
  "work_items": ["WorkItem"],
  "route_groups": ["RouteGroup"],
  "warnings": ["string"],
  "required_confirmations": ["string"],
  "dispatch_ready": "boolean",
  "blocked_task_state": "string | null",
  "interface_change_proposal": "string | null",
  "created_at": "ISO8601"
}
```

### RouterReviewResult
```json
{
  "task_id": "uuid",
  "status": "accepted | accepted_with_warnings | rejected | needs_revision",
  "decomposition_summary": "string",
  "conflict_summary": "string | null",
  "route_group_summary": "string",
  "warnings": ["string"],
  "created_at": "ISO8601"
}
```

### RouteGroupRuntime
```json
{
  "route_group_id": "uuid",
  "task_id": "uuid",
  "status": "pending | running | done | failed | blocked",
  "current_stage": "string",
  "run_ids": ["uuid"],
  "waiting_for": "string | null",
  "blocking_reason": "string | null",
  "wait_gate_event": "string | null",
  "human_confirmation_required": "boolean",
  "updated_at": "ISO8601"
}
```

### RouteGroupResult
```json
{
  "route_group_id": "uuid",
  "task_id": "uuid",
  "status": "done | failed | partial | blocked",
  "summary": "string",
  "result_ref": "string | null",
  "validation_report_refs": ["string"],
  "warnings": ["string"],
  "created_at": "ISO8601"
}
```

---

## Internal Interfaces (Backend)

### ModelProvider (abstract)
```python
def generate(self, messages: list[dict], params: dict) -> str
```
- `messages`: OpenAI-compatible message list: `[{"role": "system/user/assistant", "content": "..."}]`
- Returns: assistant text response

### RuntimeStore
```python
def save_task(task_id: str, task_contract: dict) -> None
def load_task(task_id: str) -> dict | None
def save_run_result(task_id: str, run_id: str, result: dict) -> None
def load_run_result(task_id: str, run_id: str) -> dict | None
def update_task_status(task_id: str, status: str, run_id: str | None) -> None
def list_tasks() -> list[dict]
# Router extensions:
def save_router_decision(task_id: str, decision: dict) -> None
def load_router_decision(task_id: str) -> dict | None
def save_router_review_result(task_id: str, review: dict) -> None
def load_router_review_result(task_id: str) -> dict | None
def save_work_items(task_id: str, items: list[dict]) -> None
def load_work_items(task_id: str) -> list[dict]
def save_route_groups(task_id: str, groups: list[dict]) -> None
def load_route_groups(task_id: str) -> list[dict]
def save_route_group_runtime(task_id: str, rg_id: str, runtime: dict) -> None
def load_route_group_runtime(task_id: str, rg_id: str) -> dict | None
def save_route_group_result(task_id: str, rg_id: str, result: dict) -> None
def load_route_group_result(task_id: str, rg_id: str) -> dict | None
```

### PromptAssembler
```python
def assemble(role: str, mode: str, task_context: dict) -> list[dict]
```
- Returns compiled prompt as message list

### ValidatorEngine
```python
def validate(task_contract: dict, agent_result: dict) -> dict
def validate_router(router_decision: dict) -> dict
```
- Returns validation_report dict

### Router
```python
def route(task_contract: dict) -> RouterDecision
```
- Decomposes normalized task into WorkItem[] and RouteGroup[]

---

## Interface Change Protocol

任何接口变更必须先更新本文件，再修改代码。  
破坏性变更必须记录到 SSOT/decisions.md。
