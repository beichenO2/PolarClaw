# Iteration Strategy（自我迭代策略与权限边界）

## Purpose / Scope

本文件定义 Sprompt/ 文件夹的自我迭代机制：谁可以提案修改哪些文件、修改如何生效、不同类别文件的审批路径。

---

## Reader / When to Read

- 任何 Agent 在试图修改 Sprompt/ 文件前必读
- 人类维护者在处理 Proposal 时必读
- CLAW 在审视自进化提案时必读

---

## Authority / Precedence

本文件服从 `constitutional/00_overview.md` 和 `constitutional/02_constraints.md`（C-10 自进化提案必须通过审批）。

---

## File Classification（文件分类）

所有 Sprompt/ 文件分为三类，每类有不同的修改权限：

### A 类：Constitutional Docs（宪法层文档）

**文件列表：**
- `constitutional/00_overview.md`
- `constitutional/01_layered_architecture.md`
- `constitutional/02_constraints.md`
- `constitutional/03_intake_policy.md`
- `constitutional/04_communication_policy.md`

**特征：** 定义系统原则、架构、永久约束、通信协议

**修改规则：**
- 只有高层 Agent（CLAW 级别）可以生成修改提案
- 提案必须明确说明：变更内容、变更原因、受影响的下层文件
- 必须经过**人工审阅后**才能生效
- 生效后必须检查并更新所有引用了被修改内容的下层文件

**禁止行为：**
- Executor/Agent 不得直接修改 A 类文件
- 不得在未生成 Proposal 的情况下修改
- 不得在未经人工审阅的情况下生效

---

### B 类：Operational Specs（运行规范）

**文件列表：**
- `operational/*.md`（所有 operational 规范文件）
- `schemas/*.json`（所有 schema 定义文件）
- `prompts/roles/*.md`（所有角色 prompt 文件）

**特征：** 定义运行规范、角色职责、消息 schema、验证规则

**修改规则：**
- 高层 Agent（Executor 级别）可以生成修改提案
- 提案格式：在 `notes/open_questions.md` 中创建条目，或生成 Proposal 对象
- 必须经过**Validator 验证 + BOT review flow** 后才能生效
- 修改 `schemas/*.json` 时，同时检查所有 `examples/` 中的样例是否仍然有效

**禁止行为：**
- Generic Agent 不得修改 B 类文件
- 不得在未记录原因的情况下修改
- 不得删除任何已有的硬约束条目

---

### C 类：Runtime Artifacts / Examples（运行时产物 / 样例）

**文件列表：**
- `examples/*.json`（所有样例文件）
- `notes/open_questions.md`（待确认问题）

**特征：** 运行时动态生成的对象样例，或记录性文档

**修改规则：**
- 可以自动生成和更新，无需审批
- 可以被任何 Agent 覆盖更新
- **不作为系统约束**（不得被引用为权威来源）

**限制：**
- `examples/` 文件只能在 `editable_scope` 中明确列出后才能修改
- 不得把 examples 文件升级为 B 类或 A 类文件（需要 Proposal 流程）

---

## Proposal Flow（提案流程）

### 针对 A 类文件的修改提案

```
1. 高层 Agent 生成提案 Markdown
   包含：变更内容（diff 描述）/ 变更原因 / 影响分析 / 建议的下层更新列表
   ↓
2. 提案提交给人类维护者审阅
   ↓
3. 审阅结果：approved / rejected / needs_revision
   ↓ （approved）
4. 人工或授权 Agent 执行修改
5. 更新所有引用被修改内容的 B 类文件
6. 在 notes/CHANGELOG.md（待创建）中记录变更
```

### 针对 B 类文件的修改提案

```
1. Executor 级 Agent 在 notes/open_questions.md 中创建 Q-xxx 条目
   或生成结构化 Proposal 对象
   包含：变更内容 / 原因 / 影响范围
   ↓
2. Validator 验证提案的结构完整性
   （不验证正确性，只验证格式）
   ↓
3. BOT review flow（CLAW 或 project_executor 审阅）
   ↓
4. approved → 执行修改 → 更新 CHANGELOG
   rejected → 记录拒绝原因，关闭 Q 条目
```

---

## What Can Evolve Without Proposal（无需提案的进化）

以下操作无需提案，可以在任务执行中直接完成：

- 在 `examples/` 目录中新增或更新样例文件
- 在 `notes/open_questions.md` 中追加新的 Q-xxx 条目
- 修改 `notes/iteration_strategy.md` 中的 Open Questions 状态（resolved/pending）
- 在 `examples/` 中新增 Agent 运行产物的记录

---

## Anti-Drift Principles（防漂移原则）

为防止系统规范在迭代中"漂移"（悄悄偏离原始意图），以下原则必须遵守：

1. **每次 A 类文件修改后**，CLAW 必须重新审视是否有下层规范需要同步更新
2. **每次 B 类 schema 文件修改后**，必须验证 examples/ 中的样例是否仍然符合新 schema
3. **任何删除现有硬约束的提案**，必须在提案中显式说明为什么这条约束不再需要（防止意外弱化）
4. **每次迭代后**，`notes/iteration_strategy.md` 的文件分类表应当被对照实际文件结构验证，确保没有新文件未被分类

---

## Version Policy（版本策略）

- 当前版本：v0.1 baseline
- 版本号格式：`vMAJOR.MINOR`（MAJOR 变更 = A 类文件修改；MINOR 变更 = B 类文件修改）
- 版本记录：`notes/CHANGELOG.md`（待创建，Q-008）
- C 类文件变更不升级版本号

---

*文件分类：Notes（记录性）*  
*修改权限：A 类权限（作为自进化策略的核心定义，修改需要人工审阅）*  
*版本：v0.1 baseline*
