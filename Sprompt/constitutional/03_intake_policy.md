# Intake Policy（输入规范化策略）

## Purpose / Scope

本文件定义 CLAW 在接收用户输入后的规范化处理策略。  
核心原则：**在进入执行前，CLAW 必须构造出一个完整的结构化 task_contract。**

系统不定义"用户通常会提供什么"，而是定义"CLAW 必须保证哪些字段存在"。

---

## Reader / When to Read

- CLAW 在每次接收用户输入时必须执行本策略
- Mode Selector 在处理 CLAW 转发的任务前验证 task_contract 完整性
- 人类维护者在设计新 Mode 时需确保新 Mode 的必要字段被本策略覆盖

---

## Authority / Precedence

本文件服从 `constitutional/00_overview.md` 和 `constitutional/02_constraints.md`。  
当本文件与 `02_constraints.md` 中的硬约束冲突时，以 `02_constraints.md` 为准。

---

## Definitions

- **task_contract**：CLAW 向 Executor 传递的标准化任务对象（JSON），包含所有必填字段
- **safe completion**：可以在不引入新风险的情况下合理推断的字段补全
- **unsafe completion**：需要人工确认才能安全填写的字段（涉及权限、资源、边界等）
- **clarification**：当字段无法安全推断时，向用户发起的澄清请求

---

## Required Fields in task_contract

进入执行层前，task_contract **必须**包含以下字段（缺失或 TBD 的字段不允许传给下游）：

| 字段 | 说明 | 是否可安全补全 |
|------|------|--------------|
| `goal` | 任务目标，明确的自然语言描述 | 可从 user_input 提取 |
| `constraints` | 约束列表（时间、资源、禁止事项等） | 可从 user_input + context 推断，但必须让用户确认 |
| `context` | 项目上下文（当前 state、技术栈等） | 从 docs/state.md 读取 |
| `editable_scope` | 白名单文件列表（硬边界） | 不可自动补全，必须显式确认 |
| `acceptance_criteria` | 验收标准列表 | 可从 goal 推断基础标准，不确定的标注 TBD |
| `mode` | 任务模式 | 可由 CLAW 推断，需用户确认 |
| `session_id` | 会话标识 | 由系统自动生成 |

---

## Completion Rules（字段补全规则）

### Rule 1: 可安全补全的字段
如果字段满足以下条件，CLAW 可以自动补全：
- 可以从 `docs/state.md` 或 `docs/interfaces.md` 中直接读取
- 是系统自动生成的标识符（session_id、task_id 等）
- 是基于 goal 可以合理推断的基础验收标准

**补全的字段必须标记来源**，例如：
```json
{
  "_source": "inferred_from_state.md",
  "value": "FastAPI backend on port 8000"
}
```

### Rule 2: 必须发起澄清的情况

以下情况 CLAW **必须停止推断**，向用户发起澄清：
- `editable_scope` 无法从上下文确定
- `goal` 存在歧义（多个互斥的可能理解）
- 关键 `constraints` 缺失（例如不清楚是否允许修改数据库）
- `acceptance_criteria` 有关键部分无法安全推断
- 任务边界超出当前 Mode 的定义范围

### Rule 3: 模糊任务不得直接传递

禁止将以下情形的任务传给下游执行层：
- goal 字段包含歧义词而未解歧
- editable_scope 为空或包含通配符
- acceptance_criteria 全部为 TBD

### Rule 4: TBD 字段的处理

如果某个字段补全后值为 TBD：
- 标注原因
- 在 task_contract 中对应字段写 `"TBD: <原因>"`
- 同时在 CLAW 的 Markdown 分析的 `TBD Fields` 部分列出
- 对于硬必填字段（goal、editable_scope），TBD 状态不允许传给 Executor

---

## Clarification Protocol（澄清协议）

当需要澄清时，CLAW 必须：

1. 明确说明哪个字段无法安全推断
2. 给出 1-3 个候选选项（如果可以）
3. 等待用户回答
4. 将用户回答记录为 `confirmed_fact`，标注来源为 `user_confirmation`

澄清不得无限循环。澄清最多发起 2 轮，如果仍然无法确定关键字段，任务进入 `BLOCKED` 状态。

---

## Pre-execution Read Requirements（执行前必读文件）

CLAW 和 Executor 在处理任务前**必须**读取：

| 角色 | 必读文件 | 时机 |
|------|---------|------|
| CLAW | `docs/state.md` | 接收任何用户输入后，理解前 |
| CLAW | `docs/interfaces.md` | 处理任何涉及接口的任务前 |
| Executor | `docs/state.md` | 接收 task_contract 后，执行前 |
| Executor | `docs/interfaces.md` | 执行任何涉及 API 的操作前 |
| Agent | task_contract 中的 editable_scope | 执行前确认白名单 |

**任何执行主体在未读取以上文件前，不得开始实际执行。**

---

## Interface Change Detection（接口变更早期检测）

CLAW 在分析任务时，如果发现以下信号，必须在 task_contract 中标注，并主动在 Markdown 分析中提示：

- 任务涉及修改 API endpoint 的路径、方法、请求体或响应体
- 任务涉及新增或删除 endpoint
- 任务涉及修改内部接口（LLMProvider、MemoryStore 等）
- 任务描述中包含"改接口"、"新增字段"、"修改 schema"等关键词

一旦检测到上述信号：
```
CLAW 输出 task_contract 时，将 `requires_interface_proposal: true` 设置为 true
Executor 接收后，在执行任何代码前必须先进入接口变更流程
```

---

## mode_selection 对象（CLAW 必须输出）

见 `schemas/mode_selection.json`

---

*文件分类：Constitutional Doc（A 类）*  
*修改权限：仅高层 Agent 提案 + 人工审阅后生效*  
*版本：v0.1 baseline*
