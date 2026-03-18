# System Constraints (Execution Constitution)

## Purpose / Scope

本文件是系统级永久约束的权威来源（Execution Constitution）。  
所有约束在此集中定义。任何角色 prompt、schema、运行规范，**均不得重定义、弱化或绕过本文件中的约束**。

本文件与 `constitutional/00_overview.md` 共同构成系统宪法层。

---

## Reader / When to Read

- 所有角色 prompt 必须在头部声明对本文件的服从
- 任何 Validator 在判定前必须以本文件的规则为基准
- 人类维护者在修改任何规范前必须先读本文件
- CLAW 在每次启动时必须加载本文件

---

## Authority / Precedence

本文件是系统中权威层级最高的约束文件之一（与 `00_overview.md` 并列）。  
**任何下层文件不得覆盖本文件中的约束。**

对于**项目事实**（端口、路径、状态、命令等），`docs/state.md` 是权威来源，本文件不干预。  
对于**系统级永久约束**（规则、协议、流程要求），本文件优先于 `docs/state.md`。

---

## Definitions

- **confirmed_fact**：已通过验证手段（命令输出、端口探测、测试通过等）确认的事实
- **inferred_hypothesis**：基于已知信息推断，但未直接验证的假设
- **unknown / TBD**：当前无法确认、不能安全推断的值
- **hard constraint**：不可绕过的规则，违反必须触发 escalation 或停止执行
- **soft guideline**：推荐遵守但可在特定情况下说明理由后偏离的规则
- **whitelist**：允许修改的文件列表，即 `editable_scope`

---

## Hard Constraints（硬约束列表）

以下约束为硬约束，违反任何一条均视为执行错误。

---

### C-01: Non-Fabrication（禁止捏造事实）

**级别：** 硬约束 — 不可绕过

**规则：**
1. 所有输出中，事实、假设、未知值必须明确区分：
   - `confirmed_facts`：已验证的事实
   - `inferred_hypotheses`：推断，必须标注为推断
   - `unknowns`：未知，必须写为 `TBD`
2. 禁止将猜测写成事实
3. 禁止在未完成验证的情况下标记任务为完成（禁止提前打 `[x]`）
4. 禁止用脑补填充未知字段

**在哪里体现：**
- role prompt 的 `Must Not Do` 段
- schema 的 field notes
- validation policy 的判定规则
- agent_result 的 `fact_status` 字段

---

### C-02: 三层执行闭环（Worker → Evidence Collector → Deterministic Validator）

**级别：** 硬约束 — 不可绕过

**规则：**
1. 每次任务执行必须经过三层：
   - **Worker**：负责产出（代码、文档、命令、分析等）
   - **Evidence Collector**：负责结构化收集证据（JSON 对象，非自由文本）
   - **Deterministic Validator**：基于 evidence object 做确定性判定
2. Worker 不负责最终判定
3. Evidence Collector 的输出必须是结构化 JSON，不接受"感觉像完成了"式的自由文本描述
4. Validator 的判定结果必须为枚举值：`PASS` / `FAIL` / `BLOCKED` / `NEED_HUMAN`
5. 禁止跳过 Evidence Collector 直接让 Validator 判定

**在哪里体现：**
- `operational/02_evidence_collection_contract.md`
- `operational/03_validator_spec.md`
- `schemas/evidence_pack.json`
- `schemas/validation_report.json`

---

### C-03: 白名单文件控制（Editable Scope Hard Boundary）

**级别：** 硬约束 — 不可绕过

**规则：**
1. 每个 task_contract、bot_run_plan、agent_task 必须包含 `editable_scope` 字段
2. Agent 只能修改 `editable_scope` 中明确列出的文件
3. 白名单外文件的任何修改操作必须：
   - 立即停止
   - 触发 escalation_request
   - 等待人工确认
4. `editable_scope` 不允许包含通配符（禁止 `**/*` 或 `*.py` 形式，必须逐一列出文件路径）
5. 白名单由 CLAW 在生成 task_contract 时确定，下游不得自行扩展

---

### C-04: 接口变更门控

**级别：** 硬约束 — 不可绕过

**规则：**
1. 一旦执行过程中发现需要变更接口 schema（`docs/interfaces.md` 中任何条目）：
   - 立即停止当前执行
   - 生成 `interface_change_proposal`（见 `schemas/interface_change_proposal.json`）
   - 进入 `BLOCKED` 状态，等待确认
2. 禁止在未完成接口提案流程的情况下修改接口相关代码
3. 接口变更确认后，必须先更新 `docs/interfaces.md`，再修改代码

---

### C-05: docs 备份与轮换

**级别：** 硬约束 — 不可绕过

**规则：**
1. 修改 `docs/` 目录下任何文件之前，必须先创建 `.bak` 备份
2. 备份文件命名：`<filename>.bak`（覆盖已有 .bak）
3. rollback depth = 1（保留最近一次备份）
4. 同一次 run 内不得删除刚创建的 .bak 文件
5. 下次任务开始时，新备份覆盖旧备份

---

### C-06: docs 权威顺序

**级别：** 硬约束 — 不可绕过

项目文档的权威顺序（从高到低）：
```
state.md > interfaces.md > decisions.md > roadmap.md
```

**规则：**
1. 对于项目事实，`state.md` 是最高权威
2. 任何与 `state.md` 冲突的其他文档，必须被修正对齐（不得"平均"冲突）
3. `decisions.md` 是 append-only，禁止修改历史条目
4. `interfaces.md` 是 contract-first，代码必须跟随它

---

### C-07: 下游不消费原始 prompt

**级别：** 硬约束 — 不可绕过

**规则：**
1. 用户的原始自然语言输入只由 CLAW 处理
2. Executor、FSM、Run、Agent 只接收结构化 `task_contract`（JSON）
3. 禁止将 `user_input` 字段直接传递给下游执行层

---

### C-08: 强检测证据链

**级别：** 硬约束 — 不可绕过

对于任何涉及以下操作的任务，必须产出对应的 evidence 记录：

| 操作类型 | 必须产出的 evidence |
|---------|-------------------|
| 服务启动 / 端口验证 | `port_probe_record` |
| 命令执行 | `command_execution_record` |
| 测试执行 | `test_execution_record` |
| 文件修改 / 创建 | `docs_change_record` 或文件 diff |
| quarantine 操作 | `quarantine_record` |
| Git 操作 | `git_change_record` |

禁止用"手动确认"代替结构化 evidence 记录。

---

### C-09: 人工确认请求必须分类

**级别：** 硬约束

`human_action_request` 必须包含枚举化的 `action_type` 字段，不允许使用通用 `reason` 字段代替。  
必须从以下枚举中选择：
- `secret_input`
- `login_required`
- `dangerous_action_approval`
- `interface_change_confirmation`
- `resource_application`
- `manual_verification`
- `ambiguity_clarification`

---

### C-10: 自进化提案必须通过审批

**级别：** 硬约束

**规则：**
1. 任何修改 constitutional/ 或 operational/ 文件的意图，必须先生成 Proposal
2. Proposal 不得直接生效，必须经过 Review 步骤
3. 修改 constitutional/ 需要人工审阅后方可生效
4. 修改 operational/ 需要 Validator + BOT review flow 审阅后方可生效
5. examples/ 中的样例文件可以自动生成和更新，无需审批

---

### C-11: 禁止删除项目文件（ClawBin 归档规则）

**级别：** 硬约束 — 不可绕过

**规则：**
1. 禁止直接删除项目文件
2. 任何不再使用的文件必须移动到 `/Users/mac/Desktop/ClawBin/`
3. 归档时必须记录：原始路径、ClawBin 路径、归档原因、时间
4. 归档记录写入 `SSOT/docOps.md` 的 Archive Log

**为什么：** 工程可追溯性，防止意外丢失，支持回滚。

---

### C-12: GitHub 定期同步（工程纪律）

**级别：** 硬约束

**规则：**
1. 每完成一个功能模块，立即 commit
2. 每完成一个阶段，立即 push 到 GitHub
3. 重要里程碑必须 push
4. commit 注释必须清晰（feat/refactor/docs/chore 格式）
5. 不得积压大量未提交变更

---

## Soft Guidelines（软规范）

以下为推荐遵守的软规范，可在说明理由后偏离：

- **G-01**：每次 Run 建议产出不超过一个 Main FSM 实例
- **G-02**：Agent 子任务建议粒度不超过单一可验证的操作
- **G-03**：evidence_pack 建议在每个 Run 结束时立即提交，不要积累
- **G-04**：Validator 判定超时（默认 30s）时建议降级为 BLOCKED，不建议自动 PASS

---

## Conflict Resolution Policy

| 冲突类型 | 处理方式 |
|---------|---------|
| 系统规范 vs 项目 state.md（事实类） | 以 state.md 为准 |
| 系统规范 vs 项目 state.md（规则类） | 以本文件为准 |
| 下层规范 vs 上层规范 | 以上层为准，记录冲突，发起修正提案 |
| 任何冲突 | 必须记录，不得静默覆盖 |

---

*文件分类：Constitutional Doc（A 类）*  
*修改权限：仅高层 Agent 提案 + 人工审阅后生效*  
*版本：v0.1 baseline*
