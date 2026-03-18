# Whitelist Policy（白名单文件控制规范）

## Purpose / Scope

本文件定义 CLAW 系统的可编辑文件白名单（editable_scope）机制。  
核心原则：**任何 Agent 只能修改明确列入白名单的文件，白名单之外的文件不得修改。**

---

## Reader / When to Read

- CLAW 在生成 task_contract 时必读（确定 editable_scope）
- 任何 Agent 在执行写操作前必读
- Validator 在检查 evidence 时必读（scope_violation 检测）

---

## Authority / Precedence

本文件服从：
- `constitutional/02_constraints.md`（C-03 是白名单硬约束）

---

## editable_scope 定义规则

### 规则 1: 由 CLAW 在 task_contract 中确定

`editable_scope` 必须由 CLAW 在生成 `task_contract` 时基于任务目标明确指定。  
下游 Executor/Agent **不得自行扩展**白名单。

### 规则 2: 必须逐一列出文件路径

```json
// 正确
"editable_scope": [
  "backend/main.py",
  "backend/llm_provider.py",
  "docs/state.md",
  "docs/interfaces.md"
]

// 错误 - 不允许通配符
"editable_scope": ["backend/**", "docs/*.md"]

// 错误 - 不允许目录
"editable_scope": ["backend/", "docs/"]
```

### 规则 3: docs 文件的白名单规则

docs 文件的修改权限：
- `docs/state.md`：可以在白名单中，但修改前必须备份
- `docs/interfaces.md`：可以在白名单中，但修改前必须完成接口变更提案
- `docs/decisions.md`：可以在白名单中，只能追加
- `docs/roadmap.md`：可以在白名单中，可自由更新
- `docs/docOps.md`：**通常不在白名单中**（规范文件，不应在任务中修改）

### 规则 4: Sprompt/ 文件的白名单规则

- `Sprompt/constitutional/` 下的文件：**禁止放入 Agent 任务的白名单**，只允许高层提案
- `Sprompt/operational/` 下的文件：只允许经过 review flow 的提案修改
- `Sprompt/examples/` 下的文件：可以放入白名单（样例文件允许自动更新）

---

## Scope Violation Response（白名单违规响应）

当 Agent 尝试修改白名单外文件时：

```
检测到白名单外文件修改尝试
    ↓
立即停止当前操作（不执行修改）
    ↓
生成 escalation_request（type: scope_violation）
    ↓
记录到 agent_result.violations
    ↓
当前 Run → BLOCKED 状态
    ↓
等待 CLAW 处理（是否需要扩展白名单）
```

---

## Typical editable_scope by Task Type（常见任务类型的白名单参考）

以下为参考，实际白名单由 CLAW 基于具体任务确定：

| 任务类型 | 典型白名单 |
|---------|----------|
| 实现新切片（后端） | `backend/*.py`（具体文件），`docs/state.md`，`docs/interfaces.md` |
| 实现新切片（前端） | `frontend/src/*.jsx`（具体文件），`docs/state.md` |
| 纯文档更新 | `docs/state.md`，`docs/roadmap.md` |
| 接口变更（审批后）| `docs/interfaces.md`，`docs/decisions.md` |
| 新增测试 | `backend/tests/*.py`，`frontend/src/*.test.js` |
| 生成 examples | `Sprompt/examples/*.json` |

---

## Whitelist in Downstream Objects（白名单传递规则）

白名单必须逐层传递：

```
task_contract.editable_scope
    ↓ (必须传递，不得丢失)
bot_run_plan.editable_scope
    ↓ (必须传递，不得丢失)
agent_task.editable_scope
    ↓ (Agent 只能操作此列表内的文件)
```

子任务的白名单**只能是父任务白名单的子集**，不得扩展。

---

*文件分类：Operational Spec（B 类）*  
*修改权限：高层 Agent 提案 + Validator/BOT review flow 审阅*  
*版本：v0.1 baseline*
