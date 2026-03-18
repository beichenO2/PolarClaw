# Layered Architecture Specification

## Purpose / Scope

本文件详细定义 CLAW 系统的分层架构，包括每层的职责边界、输入输出契约、控制面划分，以及各层之间的交互规则。

---

## Reader / When to Read

- 任何 Executor / BOT 在处理任务前必读
- 任何 Agent 在执行前必读本文件的对应层章节
- FSM 设计者在设计新 FSM 前必读
- 人类维护者在修改系统结构前必读

---

## Authority / Precedence

本文件服从 `constitutional/00_overview.md`。  
本文件优先于 `operational/` 和 `schemas/` 中的所有文件。  
任何与本文件冲突的下层规范，以本文件为准。

---

## Layer 1: CLAW

### 定位

CLAW 是系统的顶层治理与编排实体。  
CLAW **不是简单路由器**，而是：
- 需求理解者
- 模式审视者
- 执行路径审视者
- 任务标准化器
- 顶层编排者

### 控制面

Markdown（人类可读，语义密度高）

### 职责

1. 接收用户自然语言输入
2. 语义理解，补全缺失字段，发起必要澄清
3. 对候选 Mode 进行审视（参见下方审视机制）
4. 对执行路径进行审视
5. 判断当前系统状态是否允许该路径
6. 输出 Markdown 任务分析
7. 生成 `task_contract`（JSON）并派发给 Executor

### 审视机制

CLAW 必须对以下五个维度进行审视，输出 `mode_review_result`：

| 维度 | 说明 |
|------|------|
| 任务匹配性 | 当前需求是否适合该 Mode |
| 能力完备性 | 当前 Mode/Executor/FSM/Pattern/Skill 组合是否足以完成任务 |
| 执行路径完整性 | 是否缺失关键步骤、验证点、等待点或回退点 |
| 系统状态一致性 | 当前配置、docs、资源状态是否支持该路径 |
| 自进化兼容性 | 该路径是否符合可演进原则，是否会造成不可控漂移 |

审视结果必须为以下枚举之一：
- `accepted`
- `accepted_with_warnings`
- `rejected`
- `needs_revision`

### CLAW 输入字段（来自 Web UI）

```json
{
  "session_id": "string",
  "user_input": "string (原始自然语言输入)",
  "selected_project": "string | null",
  "user_constraints": ["string"],
  "preferred_mode": "string | null"
}
```

### CLAW 输出（Markdown 分析）

固定结构：
```markdown
# Task Analysis
## User Intent（理解的用户意图）
## Inferred Constraints（推断的约束）
## Candidate Modes（候选 Mode 及理由）
## Recommended Mode（推荐 Mode + 理由）
## Mode Review（审视结论，枚举值）
## Execution Path Review（路径审视结论）
## Risks（风险清单）
## TBD Fields（无法安全推断的字段）
## Required Confirmations（需要用户确认的事项）
## Standardized Task Summary（给 Executor 的任务摘要）
```

### CLAW 输出（task_contract JSON）

见 `schemas/task_contract.json`

---

## Layer 2: Mode

### 定位

Mode 是一类任务的工作范式定义对象。Mode **不是运行实例**。

### 当前注册 Mode

| Mode ID | 说明 |
|---------|------|
| `knowledge_mode` | 知识解释、问题求解、知识链构建、教学式输出 |
| `project_mode` | 工程项目规划、拆解、实现、验证、调试、汇报 |

未来可扩展（TBD，需注册）：
- `research_mode`
- `writing_mode`
- `debug_mode`
- `analysis_mode`

### Mode 定义必须包含

- 目标类型
- 允许的输出形式
- 推荐 Main Workflow FSM 列表
- 推荐 Shared Workflow FSM 列表
- 常用 Pattern 列表
- 评估标准

---

## Layer 3: Executor / BOT

### 定位

Executor 是某个 Mode 下的实际执行主体。接收 `task_contract`，组织执行。

### 控制面

JSON（从此层开始，所有输入输出均为强结构化 JSON）

### 当前注册 Executor

| Executor ID | 绑定 Mode |
|-------------|-----------|
| `knowledge_executor` | `knowledge_mode` |
| `project_executor` | `project_mode` |

### Executor 职责

1. 接收 `task_contract`
2. 选择 Main Workflow FSM
3. 激活相关 Shared Workflow FSM
4. 创建 Run
5. 调度 Agent
6. 收集 Run 结果
7. 回传给 CLAW

### Executor 必须在执行前读取

- `docs/state.md`（了解项目当前状态）
- `docs/interfaces.md`（了解接口契约）

---

## Layer 4: Workflow FSM

### 定位

FSM 是 BOT/Executor 内部的中层工作流控制器。分为 Main FSM 和 Shared FSM。

### Main Workflow FSM

- 定义某类任务的主流程骨架
- 由 Executor 选用，一次任务通常绑定一个
- 管理 Run 生命周期
- 可调用 Shared FSM

当前候选：
- `KnowledgeExplainFSM`
- `ProblemSolvingFSM`
- `KnowledgeChainFSM`
- `ProjectMainFSM`
- `ProjectPlanningFSM`
- `ProjectDebugFSM`

### Shared Workflow FSM

- 可跨 Mode 复用的治理性流程
- 通常处理：验证、人工介入、补录、审查

当前候选：
- `HumanActionFSM`（处理需要人工操作的情况）
- `ManualRunReconcileFSM`（手动步骤对账）
- `ValidationFSM`（通用验证流程）
- `ReviewFSM`（审查流程）

### FSM 与其他层的接口边界

| 接口 | 说明 |
|------|------|
| 输入 | `bot_run_plan`（JSON） |
| 输出 | `run` 对象状态更新，`validation_report`，`escalation_request` |
| wait gate 挂接点 | FSM 状态 `WAITING_HUMAN_CONFIRMATION`，`WAITING_INTERFACE_APPROVAL` |
| interface change proposal 挂接点 | FSM 状态 `INTERFACE_CHANGE_DETECTED` |

### FSM 定义 schema（草案）

```json
{
  "fsm_name": "string",
  "fsm_type": "main | shared",
  "owner": "executor_id | shared_registry",
  "states": ["string"],
  "initial_state": "string",
  "terminal_states": ["DONE", "FAILED", "BLOCKED"],
  "transitions": [
    {
      "from": "string",
      "to": "string",
      "event": "string",
      "guards": ["string"],
      "actions": ["string"]
    }
  ],
  "wait_gates": [
    {
      "state": "string",
      "trigger": "human_action | interface_approval | external_condition",
      "timeout_policy": "escalate | fail"
    }
  ]
}
```

---

## Layer 5: Run

### 定位

Run 是一次具体执行实例。

### Run 必须包含的字段

```json
{
  "run_id": "string (唯一标识)",
  "executor_id": "string",
  "fsm_name": "string",
  "goal": "string",
  "editable_scope": ["string (白名单文件列表)"],
  "status": "queued | running | waiting | failed | done | blocked",
  "agent_ids": ["string"],
  "evidence_refs": ["string"],
  "validation_report_id": "string | null",
  "result_ref": "string | null",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### 白名单硬规则

- `editable_scope` 是硬边界
- Run 内所有 Agent 只能修改该列表中的文件
- 任何超出白名单的操作必须触发 escalation，不得静默执行

---

## Layer 6: Agent

### 定位

Agent 是 Run 内被调度的执行单元。

### Agent 职责

- 承接一个子任务
- 调用 Skill
- 应用 Pattern
- 生成结果与 evidence

### Agent 特性

- 可并发调度
- 可专门化（不同模型偏好）
- 不直接判定任务是否成功（由 Validator 判定）

### Agent 必须产出

- `agent_result`（JSON）
- 对应的 evidence 记录（port_probe / command / test 等）

---

## Layer 7: Pattern / Skill

### Pattern

可复用微型过程单元，形式可以是：
- checklist
- mini-FSM
- recipe
- decision-tree
- rule-pack

当前候选 Pattern（项目 mode）：
- `APISetupPattern`
- `DebugTriagePattern`
- `PatchIntegrationPattern`
- `PortProbePattern`

当前候选 Pattern（知识 mode）：
- `ConceptExpansionPattern`
- `KnowledgeGapCheckPattern`
- `LayeredExplanationPattern`

### Skill

具体工具能力，类型包括：
- 工具调用
- 本地命令执行
- 文件操作（仅白名单内）
- 网络探测（端口探测）
- 文档更新
- 验证器执行

---

## Escalation / Exception

| 情况 | 动作 |
|------|------|
| 超出白名单 | 触发 escalation_request，停止执行 |
| 接口变更需求 | 生成 interface_change_proposal，进入 BLOCKED |
| Validator 判定 NEED_HUMAN | 生成 human_action_request |
| FSM 未处理状态 | 记录为 BLOCKED，等待 Review |

---

*文件分类：Constitutional Doc（A 类）*
*修改权限：仅高层 Agent 提案 + 人工审阅后生效*
*版本：v0.1 baseline*
