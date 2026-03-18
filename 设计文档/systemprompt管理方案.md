# SystemPrompt 管理方案

> 本文档描述 PolarClaw 中 prompt 的组织策略、文件结构，以及各 AI 角色如何被调用和加载。  
> 权威实现：`Sprompt/` 目录 + `backend/prompt_runtime/` + `backend/ssot_reader/`

---

## 1. 核心理念

### 1.1 "Sprompt = Prompt 的源代码"

Sprompt 不是直接发给模型的字符串，而是 prompt 的**结构化源代码**。运行时由 `PromptAssembler` 编译成 OpenAI-compatible message list 再发送。

```
Sprompt/ (源码)
    ↓  PromptAssembler.assemble()
[{"role":"system","content":"..."},{"role":"user","content":"..."}]
    ↓  provider.generate()
LLM Response
```

### 1.2 分层权威（越上层越难改）

```
constitutional/   ← A 类：系统宪法，修改需人工审阅
operational/      ← B 类：运行规范，修改需 review 流
schemas/          ← B 类：JSON Schema
prompts/roles/    ← B 类：角色定义
examples/         ← C 类：样例，可自动生成
```

**规则：下层文件不得覆盖上层约束。** 即 `prompts/roles/` 中的 prompt 不得绕过 `constitutional/` 中的硬规则。

### 1.3 对 SSOT 的关系

```
SSOT/state.md       → 系统事实（Provider、Milestone、Architecture）
SSOT/interfaces.md  → API 契约（runtime objects schema）
Sprompt/            → AI 行为规范（角色、策略、约束）
```

SSOT 是"项目真相"，Sprompt 是"AI 行为规范"，两者互相引用但各自独立管理。

---

## 2. 文件结构详解

```
Sprompt/
├── README.md                          ← 快速定位索引，所有角色都应读
│
├── constitutional/                    ← A 类（系统宪法层）
│   ├── 00_overview.md                 系统目的、核心原则、分层总览
│   │                                  → 所有角色首次启动前必读
│   ├── 01_layered_architecture.md     各层边界和职责（含 Router 层 1.5）
│   ├── 02_constraints.md              永久约束（Non-Fabrication / 三层闭环 / 白名单）
│   ├── 03_intake_policy.md            用户输入规范化（goal 拆解、mode 检测）
│   └── 04_communication_policy.md     层间通信协议（wait gate / escalation / human_action）
│
├── operational/                       ← B 类（运行规范）
│   ├── 01_docops_policy.md            文档操作规范（备份、归档、commit）
│   ├── 02_evidence_collection_contract.md  Evidence Collector 收集合同
│   ├── 03_validator_spec.md           Validator 判定规范（PASS/FAIL/PARTIAL 条件）
│   ├── 04_interface_change_gate.md    接口变更门控（contract-first 流程）
│   ├── 05_whitelist_policy.md         文件编辑白名单策略
│   └── 06_router_policy.md            Router 拆分 / RouteGroup 组装规则
│
├── schemas/                           ← B 类（JSON Schema）
│   ├── task_contract.json             任务契约对象
│   ├── agent_task.json                Agent 子任务分配
│   ├── agent_result.json              Agent 执行结果
│   ├── evidence_pack.json             证据包
│   ├── validation_report.json         验证报告
│   ├── bot_run_plan.json              Executor 执行计划
│   ├── mode_selection.json            Mode 选择结果
│   ├── human_action_request.json      人工操作请求
│   ├── interface_change_proposal.json 接口变更提案
│   ├── blocked_task_state.json        任务阻塞快照
│   ├── wait_gate_event.json           Wait Gate 事件
│   └── escalation_request.json        上报请求
│
├── prompts/roles/                     ← B 类（角色 prompt）
│   ├── CLAW.md                        顶层治理与编排
│   ├── Router.md                      WorkItem 拆分 / RouteGroup 组装
│   ├── mode_selector.md               Mode 分析与推荐
│   ├── project_executor.md            project_mode 执行主体
│   ├── knowledge_executor.md          knowledge_mode 执行主体
│   ├── generic_agent.md               通用 Agent（执行子任务）
│   ├── evidence_collector.md          三层闭环第二层
│   └── deterministic_validator.md     三层闭环第三层
│
├── examples/                          ← C 类（自动生成样例）
├── migration/                         ← 老项目资产迁移说明
└── notes/                             ← 设计问题记录 / 迭代策略
```

---

## 3. 角色 Prompt 格式规范

每个 `prompts/roles/*.md` 文件必须包含以下结构：

```markdown
# Role: [角色名]

## 1. Identity / Who You Are
（你是谁，在系统中的位置）

## 2. Goal
（本角色的单一最高目标）

## 3. Inputs
（接收什么输入）

## 4. Must Do
（必须执行的行为清单）

## 5. Must Not Do
（绝对禁止的行为清单）

## 6. Output Contract
（输出格式要求）

## 7. Escalation Conditions
（何时停止并上报）

## 8. Authority / Precedence
（优先服从哪些文件）
```

**Branch-specific 扩展（Branch 功能上线后）：**  
协作任务的角色 prompt 额外增加：
```markdown
## 9. Collaboration Context
（branch 模式下：我的 branch ID、协作者是谁、如何感知对方的变更）
```

---

## 4. PromptAssembler：如何加载 prompt

### 调用链

```
orchestrator.run_task(task_contract)
    ↓
assemble(role, mode, task_contract, packed_context)   ← prompt_runtime/assembler.py
    ├── get_role_prompt(role)          ← 读取 Sprompt/prompts/roles/{role}.md
    ├── get_constraint_summary()       ← 读取 Sprompt/constitutional/02_constraints.md
    └── ContextPacker.pack()           ← 将 task_contract + SSOT 摘要 打包成 context string
    ↓
list[dict]  OpenAI-compatible message list
    ↓
provider.generate(messages)
```

### 编译后的 Message 结构

```python
[
  {
    "role": "system",
    "content": """
You are operating as part of the CLAW system.
## Your Role
{role_prompt}          ← 来自 Sprompt/prompts/roles/{role}.md
## Active Mode
{mode}
## Critical Constraints
{constraints_summary}  ← 来自 Sprompt/constitutional/02_constraints.md
"""
  },
  {
    "role": "user",
    "content": """
## Task
Goal: {task_contract.goal}
Mode: {mode}
Constraints: {constraints}
## Context
{packed_context}       ← ContextPacker 打包的 SSOT 摘要 + task 上下文
"""
  }
]
```

### role → prompt 文件映射

```python
# backend/prompt_runtime/assembler.py
ROLE_PROMPT_MAP = {
    "CLAW":                   → Sprompt/prompts/roles/CLAW.md
    "project_executor":       → Sprompt/prompts/roles/project_executor.md
    "knowledge_executor":     → Sprompt/prompts/roles/knowledge_executor.md
    "generic_agent":          → Sprompt/prompts/roles/generic_agent.md
    "evidence_collector":     → Sprompt/prompts/roles/evidence_collector.md
    "deterministic_validator":→ Sprompt/prompts/roles/deterministic_validator.md
}
```

### mode → executor role 映射

```python
# backend/orchestrator/orchestrator.py
MODE_EXECUTOR_MAP = {
    "knowledge_mode": "knowledge_executor",
    "project_mode":   "project_executor",
}
```

---

## 5. 每个 AI 角色的调用时机

| AI 角色 | 调用时机 | task_type | model |
|---------|---------|-----------|-------|
| **Router** | task_contract 生成后，dispatch 前 | `router` | kimi-k2.5 |
| **CLAW** | 顶层治理审视（目前 embedded 在 system prompt 中） | `agent` | kimi-k2.5 |
| **project_executor** | project_mode 任务执行 | `coding` | qwen3-coder-plus |
| **knowledge_executor** | knowledge_mode 任务执行 | `agent` | kimi-k2.5 |
| **generic_agent** | 通用子任务执行（fallback） | `agent` | kimi-k2.5 |
| **evidence_collector** | 执行后收集证据（三层闭环第二层） | `agent` | kimi-k2.5 |
| **deterministic_validator** | 验证结果（三层闭环第三层） | `agent` | kimi-k2.5 |

> **debug 场景**（未来）：project_executor 产出后，让 `MiniMax-M2.7` (task_type=debug) 做 B-model review，实现跨厂商交叉验证。

---

## 6. Branch 功能专属 Prompt（规划中）

Branch 功能（roadmap: Next）需要专属 systemPrompt，格式为 JSON（规范型）。

### 手动 Branch 协作提醒 Prompt

```json
{
  "type": "branch_collaboration_notice",
  "branch_id": "branch-001",
  "parent_task_id": "uuid",
  "executor_id": "executor-A",
  "sibling_executor_ids": ["executor-B"],
  "workspace": "shared (same repo)",
  "notice": [
    "此任务在 branch 模式下执行",
    "执行前先检查 runtime/branch_sync/{parent_task_id}/changes.json 中是否有兄弟 executor 的变更",
    "每次 commit 前更新 runtime/branch_sync/{parent_task_id}/changes.json",
    "不要覆盖兄弟 executor 正在修改的文件（参见 changes.json 中的 locked_files）",
    "如发生冲突，写入 runtime/branch_sync/{parent_task_id}/conflicts.json 等待人工解决"
  ],
  "sync_protocol": {
    "check_changes_before": "every_action",
    "update_changes_after": "every_commit",
    "conflict_handling": "pause_and_report"
  }
}
```

### 自动分拆 Branch Prompt（Router 自动分发版）

```json
{
  "type": "auto_branch_dispatch_notice",
  "parent_task_id": "uuid",
  "total_branches": 2,
  "my_work_items": ["wi-001"],
  "other_work_items": ["wi-002"],
  "shared_context": {
    "repo": "same workspace",
    "editable_whitelist_mine": ["backend/router/"],
    "editable_whitelist_others": ["frontend/src/"]
  },
  "sync_notice": "此任务由 Router 自动拆分并分配，请避免修改 other_work_items 对应的 editable_whitelist 范围内的文件"
}
```

---

## 7. Prompt 修改流程（自进化规则）

| 文件类型 | 修改条件 | 流程 |
|---------|---------|------|
| constitutional/ | 发现重大约束缺失或矛盾 | 人工审阅 + decisions.md 记录 |
| operational/ | 运行规范需迭代 | interface_change_proposal → review |
| schemas/ | 字段需要增减 | SSOT/interfaces.md 先改 → 再改 schema |
| prompts/roles/ | 角色行为需调整 | 最小改动 + decisions.md 说明原因 |
| examples/ | 样例过时 | 可直接更新，无需审批 |

**禁止行为：**
- 不得用 prompt 修改绕过 Non-Fabrication 约束
- 不得在 role prompt 中内联 SSOT 事实（事实在 ContextPacker 注入，不重复写死）
- 不得删除 Must Not Do 章节的内容

---

## 8. 快速参考：新增角色的标准步骤

1. 在 `Sprompt/prompts/roles/` 下创建 `{role_name}.md`，按第 3 节格式填写
2. 在 `backend/prompt_runtime/assembler.py` 的 `ROLE_PROMPT_MAP` 中注册
3. 在 `backend/orchestrator/orchestrator.py` 的 `MODE_EXECUTOR_MAP` 中（如需）绑定 mode
4. 在 `SSOT/decisions.md` 中记录角色引入决策
5. 在本文档第 5 节调用时机表中补充该角色
