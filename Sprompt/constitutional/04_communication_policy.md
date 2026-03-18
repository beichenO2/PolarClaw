# Communication Policy（通信协议）

## Purpose / Scope

本文件定义 CLAW 系统各层之间的通信协议，包括：
- 哪层使用 Markdown，哪层使用 JSON
- 消息传递的格式要求
- wait gate / blocked state / escalation 的触发与处理协议
- human_action_request 的分类协议
- 各层对象的生命周期

---

## Reader / When to Read

- Executor / BOT 设计者必读
- FSM 设计者必读
- Validator 设计者必读
- 任何涉及层间消息传递的开发必读

---

## Authority / Precedence

本文件服从 `constitutional/00_overview.md` 和 `constitutional/02_constraints.md`。

---

## Control Plane Division（控制面划分）

| 层 | 控制面 | 原因 |
|----|--------|------|
| User / Web UI → CLAW | 自然语言 + Markdown | 用户输入，需要高泛化处理 |
| CLAW 内部分析 | Markdown | 语义密度高，适合治理审视 |
| CLAW → Executor | JSON (`task_contract`) | 必须结构化，可机器解析 |
| Executor → FSM | JSON (`bot_run_plan`) | 必须结构化 |
| FSM → Run/Agent | JSON (`agent_task`) | 必须结构化 |
| Agent → Validator | JSON (`evidence_pack` + `agent_result`) | 必须可确定性验证 |
| Validator → FSM | JSON (`validation_report`) | 必须可机器处理 |
| FSM → CLAW（结果） | JSON (`run_result`) | 必须结构化 |
| CLAW → Web UI（响应） | Markdown + JSON 摘要 | 人类可读 |

**硬规则：Executor 及以下层之间的所有消息必须是 JSON，不得使用自由文本。**

---

## Wait Gate Protocol（等待门控协议）

### 触发条件

以下情况会触发 wait gate，FSM 进入 `WAITING` 状态：

| 触发条件 | 类型 | 对应 human_action_request.action_type |
|---------|------|--------------------------------------|
| 需要用户提供 secret/token | `WAITING_SECRET_INPUT` | `secret_input` |
| 需要用户登录 | `WAITING_LOGIN` | `login_required` |
| 需要用户审批危险操作 | `WAITING_DANGEROUS_APPROVAL` | `dangerous_action_approval` |
| 接口变更需要确认 | `WAITING_INTERFACE_APPROVAL` | `interface_change_confirmation` |
| 需要申请外部资源 | `WAITING_RESOURCE` | `resource_application` |
| Validator 判定 NEED_HUMAN | `WAITING_MANUAL_VERIFICATION` | `manual_verification` |
| 关键字段无法推断 | `WAITING_CLARIFICATION` | `ambiguity_clarification` |

### Wait Gate 流程

```
检测到触发条件
  → 当前 Run 状态更新为 BLOCKED 或 WAITING
  → 生成 wait_gate_event（JSON）
  → 生成 human_action_request（JSON，含 action_type）
  → 推送到 Web UI 展示
  → 等待用户响应
  → 用户响应后，更新 wait_gate_event.resolved = true
  → FSM 恢复执行
```

### Wait Gate 超时策略

- 默认超时：无（等待人工，不自动超时）
- 危险操作确认：可配置超时，超时后自动 FAIL（不自动 PASS）
- 澄清请求：最多等待 2 轮，仍无法确认则任务 BLOCKED

---

## Blocked State Protocol（阻塞状态协议）

### blocked_task_state 对象

当任务被阻塞时，必须生成 `blocked_task_state` 对象（见 `schemas/blocked_task_state.json`），包含：
- 阻塞原因
- 阻塞时的 FSM 状态快照
- 恢复所需条件
- 关联的 wait_gate_event

### 阻塞恢复

- 阻塞状态的任务不得被自动恢复执行，必须有明确的恢复事件
- 恢复事件必须被记录在 `wait_gate_event.resolution` 中

---

## Escalation Protocol（上报协议）

### 触发条件

| 情况 | escalation 类型 |
|------|----------------|
| Agent 尝试修改白名单外文件 | `scope_violation` |
| FSM 遇到未定义的状态转移 | `fsm_undefined_transition` |
| Validator 无法基于 evidence 判定 | `validation_insufficient_evidence` |
| 任务超出当前 Mode 能力范围 | `mode_capability_exceeded` |
| 系统约束冲突检测 | `constraint_conflict` |

### escalation_request 对象

见 `schemas/escalation_request.json`。  
escalation 必须包含：
- 触发原因（枚举 + 描述）
- 当前执行上下文（run_id、agent_id、fsm_state）
- 建议处理动作

---

## human_action_request 分类协议

**硬规则：** `human_action_request` 必须包含 `action_type` 枚举字段，禁止使用通用 `reason` 字段代替。

### action_type 枚举

| action_type | 触发场景 | UI 展示建议 |
|------------|---------|------------|
| `secret_input` | 需要 API Key、密码、Token | 密码输入框，不回显 |
| `login_required` | 需要登录某个服务 | 登录引导界面 |
| `dangerous_action_approval` | 删除文件、格式化、覆写生产数据等 | 红色警告框 + 需要输入确认文字 |
| `interface_change_confirmation` | 接口变更 proposal 等待确认 | diff 展示 + 接受/拒绝按钮 |
| `resource_application` | 需要申请 GPU、云资源、外部账号等 | 资源申请表单 |
| `manual_verification` | Validator 判定 NEED_HUMAN，需人工验证 | 操作步骤 + 确认清单 |
| `ambiguity_clarification` | 澄清歧义字段 | 问题列表 + 选项或输入框 |

### human_action_request 对象

见 `schemas/human_action_request.json`

---

## interface_change_proposal 协议

### 触发

任何执行主体发现需要修改 `docs/interfaces.md` 时，必须：

1. 立即停止当前执行
2. 生成 `interface_change_proposal`
3. 当前 Run 进入 `BLOCKED` 状态
4. 推送 `human_action_request`（action_type: `interface_change_confirmation`）

### interface_change_proposal 必须包含

- 变更前的 schema
- 变更后的 schema
- 变更原因
- 影响范围评估
- 关联 run_id

### 确认后流程

1. 人工确认 → `interface_change_proposal.status = approved`
2. 更新 `docs/interfaces.md`（先备份 .bak）
3. 更新 `docs/decisions.md`（追加新决策条目）
4. 恢复 Run 执行
5. 后续代码修改必须与新接口一致

### 拒绝后流程

1. `interface_change_proposal.status = rejected`
2. 当前 Run 状态更新（FAILED 或 需要重新规划）
3. 记录拒绝原因

---

## Message Lifecycle（消息生命周期）

| 对象 | 创建者 | 消费者 | 生命周期 |
|------|--------|--------|---------|
| `task_contract` | CLAW | Executor | 一次任务全程有效 |
| `bot_run_plan` | Executor | FSM | 一次任务全程有效 |
| `agent_task` | FSM | Agent | 一次 Run 内有效 |
| `agent_result` | Agent | Evidence Collector | 提交后归档 |
| `evidence_pack` | Evidence Collector | Validator | 不可变，永久归档 |
| `validation_report` | Validator | FSM / Executor | 不可变，永久归档 |
| `wait_gate_event` | FSM | Web UI / Human | resolved 后关闭 |
| `human_action_request` | FSM / Agent | Web UI / Human | 响应后关闭 |
| `interface_change_proposal` | Agent / Executor | CLAW / Human | 审批后关闭 |
| `blocked_task_state` | FSM | Executor / Human | 解除阻塞后关闭 |
| `escalation_request` | 任何层 | CLAW / Human | 处理后关闭 |

---

*文件分类：Constitutional Doc（A 类）*  
*修改权限：仅高层 Agent 提案 + 人工审阅后生效*  
*版本：v0.1 baseline*
