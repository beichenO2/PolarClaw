# Legacy Asset Migration Map（老项目资产迁移说明）

## Purpose / Scope

本文件记录老项目（PolarClaw v0 / 早期探索项目）的资产评估结果，说明哪些资产被直接继承、哪些被改写后继承、哪些仅作为经验参考不直接沿用，以及映射关系。

---

## Reader / When to Read

- 系统初始化时，了解当前 Sprompt/ 的设计来源
- 迭代时，评估是否有遗漏的老项目资产可以复用
- 人类维护者在维护 docs/ 时，了解其与 Sprompt/ 的关系

---

## Authority / Precedence

本文件是记录性文件，不是约束性文件。  
本文件服从 `constitutional/00_overview.md`（系统总览）。

---

## 老项目资产总览

老项目完成了以下成果：

| 类别 | 具体内容 |
|------|---------|
| 工程实体 | FastAPI 后端（8000），Vite+React 前端（3000），双切片可运行 |
| 接口 | GET /health, POST /chat，统一错误格式 |
| 关键设计 | LLMProvider 抽象层（llm_provider.py） |
| 文档体系 | 5 文件系统（state.md/interfaces.md/decisions.md/roadmap.md/docOps.md） |
| 流程规范 | Vertical Slice, DocOps, 备份轮换, 接口变更门控, Non-Fabrication |
| Agent 模板 | 根目录 `prompt` 文件 |
| 知识沉淀 | 经验.md, 通用经验.md |
| GitHub 流程 | gh CLI 完整流程 |

---

## 资产评估与映射

### 类别 A：直接继承（核心价值高，完全兼容新架构）

#### A1. docs 五件套文档体系

**老项目实现：** `docs/state.md`, `docs/interfaces.md`, `docs/decisions.md`, `docs/roadmap.md`, `docs/docOps.md`

**新架构映射：**
- 全部保留，位置不变（`docs/` 目录）
- `docs/state.md` → 在 `constitutional/03_intake_policy.md` 和所有 role prompt 中明确为"执行前必读"
- `docs/interfaces.md` → 在 `operational/04_interface_change_gate.md` 中作为接口变更门控的核心目标文件
- `docs/decisions.md` → 在所有 operational 规范中保持 append-only 规则
- `docs/docOps.md` → 被 `operational/01_docops_policy.md` 扩展并系统化

**继承状态：** 完全继承，并在 Sprompt/ 中升级为更正式的系统级规范

---

#### A2. Non-Fabrication 规则

**老项目实现：** `docs/docOps.md` 中的 Non-Fabrication Rule（未知值写 TBD，不猜测，不提前打 [x]）

**新架构映射：**
- 升级为系统级硬约束 C-01（`constitutional/02_constraints.md`）
- 在每个 role prompt 的 `Must Not Do` 中显式列出
- 在 `schemas/agent_result.json` 中通过 `fact_status` 字段强制区分 confirmed_facts / inferred_hypotheses / unknowns

**继承状态：** 完全继承，并升级为不可绕过的硬约束

---

#### A3. DocOps 备份轮换规则

**老项目实现：** 修改 docs 前创建 .bak，rollback depth = 1，下次任务开始时覆盖

**新架构映射：**
- 升级为硬约束 C-05（`constitutional/02_constraints.md`）
- 在 `operational/01_docops_policy.md` 中详细定义

**继承状态：** 完全继承，升级为硬约束

---

#### A4. 接口变更门控（Contract-first 原则）

**老项目实现：** 发现需要改接口 → 停下 → 先提案 → 等确认 → 才能动代码

**新架构映射：**
- 升级为硬约束 C-04（`constitutional/02_constraints.md`）
- 新增 `interface_change_proposal` JSON schema（`schemas/interface_change_proposal.json`）
- 新增完整流程规范（`operational/04_interface_change_gate.md`）
- 在 `task_contract` 中新增 `requires_interface_proposal` 字段
- 在所有 role prompt 中显式要求执行前读取 `docs/interfaces.md`

**继承状态：** 核心原则完全继承，并升级为正式消息协议

---

#### A5. Vertical Slice 开发方法论

**老项目实现：** 每个切片有明确 Non-goals，先实现最小闭环，验证通过才推进

**新架构映射：**
- 在 `prompts/roles/project_executor.md` 中作为 Must Do 明确写入
- `task_contract.acceptance_criteria` 对应每个切片的验收标准
- `validation_report` 确保每个切片验证通过才能打 PASS

**继承状态：** 完全继承，嵌入 project_executor 的执行规范

---

### 类别 B：改写后继承（有价值，但需要适配新架构）

#### B1. 根目录 `prompt` 模板文件

**老项目实现：** 根目录下的 `prompt` 文件，定义了 Agent 任务模板（硬约束列表、允许/禁止文件列表、上下文注入点、输出格式）

**评估：**
- 核心思想完全正确（白名单控制、上下文注入、输出格式要求）
- 格式是非结构化文本，新架构需要 JSON 结构化

**新架构映射：**
- 白名单控制 → `task_contract.editable_scope`（JSON 字段）+ `operational/05_whitelist_policy.md`
- 上下文注入 → `task_contract.context`（结构化）
- 输出格式要求 → 各 role prompt 的 `Output Contract` 段落
- 硬约束列表 → `constitutional/02_constraints.md`（系统级）和 role prompt 的 `Must Not Do`

**映射文件：**
- `schemas/task_contract.json`（白名单 + 上下文 + 验收标准）
- `schemas/agent_task.json`（子任务级白名单）
- `prompts/roles/generic_agent.md`（输出契约）

**继承状态：** 核心原则继承，结构从自由文本升级为 JSON schema + role prompt

---

#### B2. 通用经验.md（技术栈无关的工程 Agent 手册）

**老项目实现：** 包含完整模板（占位符版）、触发规则表、执行流程图、常见错误对照表

**评估：**
- 内容高价值，直接可迁移
- 需要重新映射到新的多层 Agent 架构

**新架构映射：**
- 触发规则表 → `operational/01_docops_policy.md` 的 Update Triggers 部分
- 执行流程图 → `constitutional/01_layered_architecture.md` 的 Workflow 部分
- 常见错误对照表 → `notes/open_questions.md`（暂存，待整理为 Pattern）

**建议：** 将 `通用经验.md` 中的最佳实践整理为 Pattern（如 `PortProbePattern`, `APISetupPattern`），放入未来的 `Sprompt/operational/patterns/` 目录

**继承状态：** 内容继承，格式待迁移为 Pattern 定义

---

#### B3. LLMProvider 抽象层设计

**老项目实现：** `llm_provider.py` 作为独立抽象层，`main.py` 只持有 provider 实例，`EchoProvider` 为 S1 stub

**评估：**
- 这是工程实体（代码），不直接进入 Sprompt/
- 但其设计思想（抽象层 + 可替换实现）是架构参考

**新架构映射：**
- 在 `docs/interfaces.md` 的内部接口部分保留 `LLMProvider` 契约
- 在 `docs/decisions.md` 中记录了 D008（LLMProvider 设计决策）
- 未来 Executor/Skill 调用 LLM 时，通过 LLMProvider 接口调用

**继承状态：** 代码资产继续使用，设计决策已在 docs/decisions.md 中记录

---

### 类别 C：仅作经验参考（不直接沿用）

#### C1. 经验.md（项目具体案例记录）

**老项目实现：** 记录了本项目的文档格式、S0/S1 执行轨迹、文件改动数量

**评估：**
- 是项目特定的历史记录，不适合直接进入新系统规范
- 作为参考，理解了双切片系统的验证轨迹

**使用方式：** 仅作为设计参考，具体 evidence 样例参考了其中的验证流程

**继承状态：** 不直接沿用，已在 `examples/evidence_pack_sample.json` 中体现其验证模式

---

#### C2. GitHub CLI 完整流程

**老项目实现：** 一套经过验证的 `gh` CLI 操作流程（认证、创建仓库、推送）

**评估：**
- 是很好的 Pattern 候选
- 新架构中，git 操作作为 Skill/Pattern 而非系统规范

**使用方式：** 可以作为未来 `GitHubPublishPattern` 的基础素材

**继承状态：** 不直接进入 Sprompt/，标记为未来 Pattern 候选（见 `notes/open_questions.md`）

---

## docs 五件套与新 prompt/spec 体系的协作关系

```
Sprompt/（系统级规范）          docs/（项目级运行时记忆）
─────────────────────          ───────────────────────
constitutional/                 state.md（项目当前状态 SSOT）
  ├── 00_overview.md   ←────── 读取项目状态（执行前必读）
  └── 02_constraints.md        interfaces.md（接口契约）
operational/                ←── 执行前必读，接口变更门控
  ├── 01_docops_policy.md ──→  决定 docs 何时更新
  └── 04_interface_change_gate.md → 触发 interfaces.md 更新
prompts/roles/                  decisions.md（只追加）
  └── project_executor.md ──→  接口变更后追加 decisions.md
schemas/                        roadmap.md（backlog）
  └── task_contract.json ←──── context 字段从 state.md 注入
```

**关键原则：**
1. Sprompt/ 是跨项目、跨任务的系统级规范（长期稳定）
2. docs/ 是项目绑定的 runtime 记忆（随项目演进）
3. CLAW 在每次处理任务时，将 docs/ 的内容注入 task_contract.context（快照）
4. Executor/Agent 通过 task_contract 获取项目上下文，不直接依赖 docs/ 文件（确保 context 一致性）

---

## 老项目 prompt 模板 → 新 Sprompt/ 结构的完整映射表

| 老项目元素 | 新 Sprompt/ 位置 |
|-----------|----------------|
| 硬约束列表 | `constitutional/02_constraints.md` |
| 允许修改的文件列表 | `schemas/task_contract.json` → `editable_scope` |
| 禁止修改的文件列表 | `operational/05_whitelist_policy.md`（隐式：白名单之外的均禁止）|
| 上下文注入点 | `schemas/task_contract.json` → `context` |
| 输出格式要求 | `prompts/roles/*.md` → `Output Contract` 段落 |
| 验收 checklist | `schemas/task_contract.json` → `acceptance_criteria` |
| Non-Fabrication 约定 | `constitutional/02_constraints.md` C-01（升级为硬约束）|
| 接口变更停下等确认 | `operational/04_interface_change_gate.md`（升级为正式协议）|
| DocOps 备份规则 | `operational/01_docops_policy.md`（系统化）|
| 三层闭环（验证机制）| `operational/02_evidence_collection_contract.md` + `03_validator_spec.md` |

---

*文件分类：Migration Notes（记录性文件）*  
*修改权限：人工维护或高层 Agent 更新*  
*版本：v0.1 baseline*
