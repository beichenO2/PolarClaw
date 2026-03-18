# Evidence Collection Contract（证据收集合同）

## Purpose / Scope

本文件定义 CLAW 系统中的证据收集机制。  
核心原则：**每次任务执行产生的所有重要操作，都必须生成结构化证据（JSON 对象），而不是自由文本描述。**

Evidence Collector 是三层执行闭环的第二层，负责在 Worker 产出后、Validator 判定前，将执行证据结构化。

---

## Reader / When to Read

- Evidence Collector 角色必读（这是其核心规范）
- Worker/Agent 在执行时必须了解它需要产出哪些 evidence
- Validator 在判定前必须验证 evidence_pack 的完整性
- FSM 设计者在设计需要验证的状态时必读

---

## Authority / Precedence

本文件服从：
- `constitutional/00_overview.md`
- `constitutional/02_constraints.md`（C-02 和 C-08 是强检测相关硬约束）

本文件优先于 `schemas/evidence_pack.json`（本文件是语义规范，schema 是结构规范）。

---

## Three-Layer Execution Loop（三层执行闭环）

```
Worker（产出执行）
    ↓
    产出：代码、文件、命令结果、分析
    ↓
Evidence Collector（结构化收集证据）
    ↓
    产出：evidence_pack（JSON）
    ↓
Deterministic Validator（确定性判定）
    ↓
    产出：validation_report（JSON，含 PASS/FAIL/BLOCKED/NEED_HUMAN）
```

**每一层的职责界限必须严守，不得越权。**

---

## Evidence Collection Responsibilities（Evidence Collector 职责）

Evidence Collector 负责：
1. 在 Worker 完成执行后，主动收集所有执行证据
2. 将证据转化为规定的 JSON 对象格式
3. 组装 `evidence_pack`
4. 将 `evidence_pack` 提交给 Validator

Evidence Collector **不负责**：
- 判定任务是否成功（这是 Validator 的职责）
- 修改任何文件（这是 Worker 的职责）
- 重新执行失败的操作

---

## Evidence Types（证据类型）

每种操作类型对应一种 evidence 记录类型。Evidence Collector 必须根据操作类型选择正确的记录格式。

### Type 1: port_probe_record（端口探测记录）

**触发条件：** 任何服务启动、端口验证操作

**必须包含字段：**
```json
{
  "type": "port_probe_record",
  "timestamp": "ISO8601",
  "host": "string",
  "port": "integer",
  "probe_method": "tcp_connect | http_get",
  "probe_url": "string (如果是 http_get)",
  "expected_response": "object | null",
  "actual_response": "object | null",
  "status": "reachable | unreachable | error",
  "latency_ms": "number | null",
  "raw_output": "string (命令或响应原始输出)"
}
```

### Type 2: command_execution_record（命令执行记录）

**触发条件：** 任何 shell 命令执行

**必须包含字段：**
```json
{
  "type": "command_execution_record",
  "timestamp": "ISO8601",
  "command": "string (完整命令，含参数)",
  "working_directory": "string",
  "exit_code": "integer",
  "stdout": "string (可截断，但不得为空)",
  "stderr": "string",
  "duration_ms": "number",
  "status": "success | failed | timeout"
}
```

### Type 3: test_execution_record（测试执行记录）

**触发条件：** 任何测试套件运行（单元测试、集成测试、验收测试）

**必须包含字段：**
```json
{
  "type": "test_execution_record",
  "timestamp": "ISO8601",
  "test_suite": "string",
  "test_command": "string",
  "total_tests": "integer",
  "passed": "integer",
  "failed": "integer",
  "skipped": "integer",
  "duration_ms": "number",
  "status": "all_passed | some_failed | all_failed | error",
  "failed_test_names": ["string"],
  "raw_output": "string"
}
```

### Type 4: docs_change_record（文档变更记录）

**触发条件：** 任何 docs/ 文件修改

**必须包含字段：**
```json
{
  "type": "docs_change_record",
  "timestamp": "ISO8601",
  "file_path": "string",
  "change_type": "create | update | delete",
  "backup_path": "string | null (如果有 .bak)",
  "summary": "string (此次修改摘要)",
  "diff_summary": "string (changed fields 列表)"
}
```

### Type 5: quarantine_record（隔离记录）

**触发条件：** 任何文件被隔离操作（移动到 quarantine 目录）

**必须包含字段：**
```json
{
  "type": "quarantine_record",
  "timestamp": "ISO8601",
  "original_path": "string",
  "quarantine_path": "string",
  "reason": "string",
  "quarantine_by": "agent_id | human"
}
```

### Type 6: git_change_record（Git 变更记录）

**触发条件：** 任何 git 操作（commit、push、branch 创建等）

**必须包含字段：**
```json
{
  "type": "git_change_record",
  "timestamp": "ISO8601",
  "operation": "commit | push | branch | merge | tag",
  "branch": "string",
  "commit_hash": "string | null",
  "commit_message": "string | null",
  "files_changed": ["string"],
  "exit_code": "integer",
  "raw_output": "string"
}
```

---

## evidence_pack Assembly（evidence_pack 组装规则）

Evidence Collector 完成所有记录后，必须组装一个 `evidence_pack`：

```json
{
  "evidence_pack_id": "uuid",
  "run_id": "string",
  "agent_id": "string",
  "created_at": "ISO8601",
  "evidence_items": [
    { "item_id": "string", "type": "port_probe_record | ...", "data": {} }
  ],
  "completeness_check": {
    "required_types": ["port_probe_record", "test_execution_record"],
    "present_types": ["port_probe_record"],
    "missing_types": ["test_execution_record"],
    "is_complete": false
  }
}
```

**completeness_check 规则：**
- `required_types` 由 task_contract 的 `acceptance_criteria` 决定
- Evidence Collector 必须验证所有 required_types 都有对应记录
- 如果 `is_complete = false`，不得提交给 Validator，必须反馈给 Agent 补充

---

## Non-Fabrication in Evidence（证据中的禁止捏造规则）

- 所有 evidence 必须来源于实际执行，禁止捏造
- `raw_output` 字段不得为空（至少包含"N/A"或实际输出）
- `exit_code` 必须是实际命令退出码，禁止猜测
- `timestamp` 必须是实际执行时间，不得使用估计值
- 禁止把失败的测试标注为 passed
- 禁止省略 `stderr` 中的错误信息

---

## Escalation from Evidence Collector

Evidence Collector 在以下情况必须发起 escalation，不得自行处理：

| 情况 | escalation 类型 |
|------|----------------|
| Worker 执行结果无法产生任何 evidence | `validation_insufficient_evidence` |
| 发现 evidence 中有白名单外文件被修改 | `scope_violation` |
| evidence 显示接口发生了未经批准的变更 | `unauthorized_interface_change` |

---

*文件分类：Operational Spec（B 类）*  
*修改权限：高层 Agent 提案 + Validator/BOT review flow 审阅*  
*版本：v0.1 baseline*
