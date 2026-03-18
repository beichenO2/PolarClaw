# CLAW Interfaces (Contract)

Rule: This file is the API contract. Do NOT change request/response shapes in code unless you first update this file.

Last Updated: 2026-03-18

---

## HTTP API — Backend (port 8000)

### GET /health
Response 200:
```json
{ "status": "ok" }
```

### POST /api/tasks
**Purpose:** 创建新任务，启动后台处理流程

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
**Purpose:** 获取任务执行结果

Response 200:
```json
{
  "task_id": "uuid",
  "run_id": "uuid",
  "status": "string",
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
    "summary": "string"
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
```

### PromptAssembler
```python
def assemble(role: str, mode: str, task_context: dict) -> list[dict]
```
- Returns compiled prompt as message list

### ValidatorEngine
```python
def validate(task_contract: dict, agent_result: dict) -> dict
```
- Returns validation_report dict

---

## Interface Change Protocol

任何接口变更必须先更新本文件，再修改代码。  
破坏性变更必须记录到 SSOT/decisions.md。
