# CLAW System Overview

## Purpose / Scope

本文件是 CLAW 系统的最顶层宪法性文件。它定义了系统的存在目的、核心原则、分层架构总览，以及本 `Sprompt/` 文件夹的组织逻辑。

所有角色 prompt、运行规范、schema 定义，**必须与本文件保持一致**。与本文件冲突时，以本文件为准，除非人工显式更新本文件。

---

## Reader / When to Read

- **CLAW**：每次启动时必读
- **Mode Selector**：任务进入前必读
- **Executor / BOT**：首次分配任务前必读
- **人类维护者**：随时
- **任何产生 Proposal 的 Agent**：提案前必读

---

## Authority / Precedence

```
constitutional/ 文件（本层）
  └── > operational/ 文件
        └── > schemas/ 定义
              └── > prompts/roles/ prompt
                    └── > examples/ 样例
```

**硬规则：下层文件不得覆盖、弱化或绕过上层文件中的约束。**

本文件服从且不覆盖：
- 项目 docs 体系中 `state.md` 对项目事实的权威性
- 系统级永久约束（Non-Fabrication、三层执行闭环、白名单文件控制等）

---

## Definitions（术语表）

| 术语 | 定义 |
|------|------|
| **CLAW** | 系统最外层治理与编排实体，不是普通路由器 |
| **Mode** | 工作模式定义对象，决定任务范式（非运行实例） |
| **Executor / BOT** | 某 Mode 下的具体执行主体 |
| **FSM** | Finite State Machine，流程控制状态机 |
| **Run** | 一次具体执行实例，有唯一 run_id |
| **Agent** | Run 内被调度的执行单元 |
| **Pattern** | 可复用微型过程单元（checklist/recipe/rule-pack 等形式） |
| **Skill** | 具体工具能力或外部动作能力 |
| **Evidence Pack** | 一次 Run 的结构化证据集合 |
| **task_contract** | CLAW 向下传递的标准化任务对象（JSON） |
| **Validator** | 基于结构化 evidence 进行确定性判定的角色 |
| **wait gate** | 系统暂停点，等待人工确认或外部条件满足 |
| **interface change proposal** | 接口变更提案，必须先提案后才能修改接口 |
| **Non-Fabrication** | 禁止把猜测写成事实的硬规则 |
| **SSOT** | Single Source of Truth，单一真相来源 |

---

## Hard Rules（不可绕过的硬约束）

以下规则在整个系统中具有最高约束力，任何角色、任何层级均不得覆盖：

### H1: Non-Fabrication（禁止捏造）
- 所有事实必须区分：`confirmed_facts` / `inferred_hypotheses` / `unknowns`
- 未知值必须写为 `TBD`，**禁止猜测填充**
- 未验证的状态禁止标记为完成（禁止提前打 `[x]`）

### H2: 三层执行闭环（强制）
每次执行必须经过：
```
Worker → Evidence Collector → Deterministic Validator
```
- Worker 负责产出，不负责最终判定
- Evidence Collector 结构化收集证据（JSON 对象，非自由文本）
- Validator 基于 evidence object 做 PASS/FAIL/BLOCKED/NEED_HUMAN 判定

### H3: 白名单文件控制
- 任何 Agent 只能修改 `editable_scope`（白名单）中明确列出的文件
- 白名单外文件不得修改，尝试修改必须进入 escalation

### H4: 接口变更门控
- 发现需要修改接口 schema → 停止执行 → 生成 `interface_change_proposal` → 进入 wait gate → 等人工确认后才能继续
- 禁止在未提案的情况下修改接口

### H5: 文档备份与轮换
- 修改任何 docs/ 文件前必须先创建 `.bak` 备份（覆盖已有 .bak）
- rollback depth = 1
- 下次任务开始时才可覆盖旧备份

### H6: docs 权威顺序
```
state.md > interfaces.md > decisions.md > roadmap.md
```
- `state.md` 是项目级 SSOT
- 冲突时以 `state.md` 为准（对项目事实）
- 冲突时以系统级永久约束为准（对规范要求）

### H7: 下游不消费原始 prompt
- 下游执行层（Executor、Agent）只能接收结构化 `task_contract`
- 禁止将用户原始 prompt 直接传给执行层

---

## System Architecture（分层架构总览）

```
Layer 0: User / Web UI
          ↓
Layer 1: CLAW（治理 + 审视 + 标准化 + 编排）
          ↓ [Markdown 控制面]
Layer 2: Mode（任务范式定义）
          ↓
Layer 3: Executor / BOT（Mode 执行主体）
          ↓ [JSON 控制面]
Layer 4: Workflow FSM（流程控制）
    ├── Main Workflow FSM（Mode 级主流程）
    └── Shared Workflow FSM（跨 Mode 复用治理流程）
          ↓
Layer 5: Run（执行实例）
          ↓
Layer 6: Agent（子任务执行单元）
          ↓
Layer 7: Pattern / Skill（可复用过程 / 具体能力）
```

**控制面分界线：**
- CLAW 层：Markdown（语义密度高，适合治理审视）
- Executor 及以下：JSON（强结构化，可验证，可回放）

---

## Workflow: 主链路

```
用户输入
→ CLAW 语义理解 + 审视
→ 字段补全 / 澄清
→ Mode 确认（用户确认或 CLAW 推断）
→ task_contract 生成（JSON）
→ Executor 接收任务
→ Main FSM 驱动执行
→ Run 创建
→ Agent 执行子任务
→ Evidence 收集
→ Validator 判定
→ Run 结果汇总
→ Executor 回传 CLAW
→ CLAW 最终响应 → Web UI
```

---

## Required Outputs（本层要求的产出）

CLAW 每次处理用户请求，必须产出：
1. Markdown 任务分析文档（含 User Intent / Candidate Modes / Mode Review / Risks 等字段）
2. `mode_selection` 对象（JSON）
3. `task_contract` 对象（JSON），传给 Executor

---

## Escalation / Exception

当以下情况发生时，必须停止执行，触发 escalation：
- 发现需要修改接口（→ interface_change_proposal）
- 任务边界超出白名单（→ escalation_request）
- Validator 判定为 NEED_HUMAN（→ human_action_request）
- 关键 TBD 字段无法安全推断（→ 发起澄清）

---

## Future Extension Points

- 新增 Mode 时，必须在 `operational/mode_registry.md` 注册（待创建）
- 新增 Executor 时，必须定义其 FSM 集合和 Pattern 集合
- 自进化提案必须经过 Proposal → Review → Register 三步，不得直接生效
- 本文件（宪法层）的修改需要最高层 Agent 提案 + 人工审阅后方可生效

---

*文件分类：Constitutional Doc（A 类）*
*修改权限：仅高层 Agent 提案 + 人工审阅后生效*
*版本：v0.1 baseline*
