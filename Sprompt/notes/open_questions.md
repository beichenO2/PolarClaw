# Open Questions & TBD（待确认问题）

## Purpose / Scope

本文件记录 Sprompt/ v0.1 baseline 中尚未解决的问题、待确认的设计决策，以及未来迭代点。  
这是"工作中"状态，不是最终答案。

**文件分类：Notes（记录性）**  
**修改权限：任何人均可追加，但解决后需要更新对应的正式文件**

---

## Open Questions（待解决）

### Q-001: Mode Registry 注册表
**问题：** 当前 Mode 仅在 Markdown 文档中列出（knowledge_mode, project_mode）。  
未来新增 Mode 时，需要一个正式的注册机制（文件或数据库）。  
**影响：** `mode_selector.md` 中的"已注册 Mode 列表"当前无正式来源  
**建议方向：** 创建 `Sprompt/operational/mode_registry.md` 或 `mode_registry.json`  
**优先级：** 中（当前只有 2 个 Mode，不紧急）

---

### Q-002: Pattern 格式标准化
**问题：** `设计文档/架构.md` 中定义了 Pattern（checklist/mini-FSM/recipe/decision-tree/rule-pack），但 Sprompt/ 中尚无标准化的 Pattern 定义格式。  
**影响：** `agent_task.patterns_to_apply` 字段当前只能填名字，无法指向具体规范  
**建议方向：** 创建 `Sprompt/operational/patterns/` 目录，每个 Pattern 一个文件  
**候选 Pattern（来自老项目经验）：**
- `PortProbePattern`（端口探测流程）
- `APISetupPattern`（API 端点实现流程）
- `DebugTriagePattern`（问题定位修复）
- `DocOpsUpdatePattern`（文档更新操作流程）
- `GitHubPublishPattern`（老项目 gh CLI 流程）
**优先级：** 中

---

### Q-003: FSM 详细定义
**问题：** 本 baseline 给出了 FSM 的接口边界和 schema 草案（`constitutional/01_layered_architecture.md`），但没有具体的状态转移图。  
**影响：** Executor 当前无法选择具体的 FSM 实例  
**建议方向：** 创建 `Sprompt/operational/fsm/` 目录，为每个 FSM 定义状态图  
**首批候选：**
- `ProjectMainFSM`（project_mode 主流程）
- `ValidationFSM`（通用验证流程）
- `HumanActionFSM`（人工介入流程）
**优先级：** 高（没有 FSM 实例，Executor 无法运行）

---

### Q-004: run_result schema
**问题：** 系统定义了 agent_result 和 validation_report，但没有定义 Executor 汇总后回传给 CLAW 的 `run_result` 对象 schema。  
**建议方向：** 创建 `schemas/run_result.json`  
**优先级：** 中

---

### Q-005: 多 Agent 并发协调
**问题：** `constitutional/01_layered_architecture.md` 提到 Agent 可以并发，但当前没有定义并发时的 evidence 合并策略和 Validator 输入格式。  
**建议方向：** 在 `operational/02_evidence_collection_contract.md` 中添加多 Agent 合并规范  
**优先级：** 低（baseline 先处理单 Agent 场景）

---

### Q-006: session 的 CLAW 层定义
**问题：** `task_contract` 包含 `session_id`，但 session 的生命周期管理、跨 session 的状态传递规则尚未在 Sprompt/ 中定义。  
**注意：** 这与老项目的 S2 切片（会话管理）有关，但 Sprompt/ 层的 session 概念与应用层的 session 不同。  
**建议方向：** 在 `constitutional/04_communication_policy.md` 或单独文件中定义 CLAW 层的 session 语义  
**优先级：** 中

---

### Q-007: Executor 注册表
**问题：** 类似 Mode Registry，当前 Executor 仅在 Markdown 中列出。  
**建议方向：** 在 `mode_registry.md` 中同时注册 Mode-Executor 映射  
**优先级：** 中（Q-001 解决后一并处理）

---

### Q-008: Sprompt/ 自身的版本控制
**问题：** 每个文件标注了 `v0.1 baseline`，但没有定义版本号的格式规范、CHANGELOG 机制。  
**建议方向：** 创建 `Sprompt/notes/CHANGELOG.md`  
**优先级：** 低

---

### Q-009: knowledge_mode 的验证机制
**问题：** knowledge_mode 的验收标准通常是定性的（结构清晰、覆盖概念等），Deterministic Validator 的判定规则不如 project_mode 明确。  
**建议方向：** 在 `operational/03_validator_spec.md` 中补充 knowledge_mode 的验证策略  
**优先级：** 中

---

### Q-010: web_ui_spec.md
**问题：** `设计文档/架构.md` 第 9 节定义了 Web UI 的交互设计（顶层输入/输出、UI 流程、Executor 工作台）。  
当前 Sprompt/ 中没有对应的 Web UI 规范文件。  
**建议方向：** 创建 `Sprompt/operational/web_ui_spec.md`，定义 CLAW 与 Web UI 的通信协议  
**优先级：** 中（实现 Web UI 前需要）

---

## Future Pattern Candidates（未来 Pattern 候选库）

以下来自老项目 `通用经验.md`，待整理为正式 Pattern 定义：

| Pattern 名称 | 来源 | 形式 |
|------------|------|------|
| `PortProbePattern` | 老项目验证流程 | checklist |
| `APISetupPattern` | 老项目 S0/S1 实现 | recipe |
| `DebugTriagePattern` | 老项目调试经验 | decision-tree |
| `DocOpsUpdatePattern` | 老项目 DocOps 规范 | checklist |
| `GitHubPublishPattern` | 老项目 gh CLI 流程 | recipe |
| `VerticalSlicePattern` | 老项目切片开发方法 | recipe |
| `InterfaceChangePattern` | 老项目接口变更门控 | mini-FSM（已升级为 operational 规范）|

---

## Resolved Questions（已解决）

*（目前 v0.1 baseline，暂无已解决条目）*

---

*文件分类：Notes（记录性）*  
*更新时间：2026-03-18*  
*版本：v0.1 baseline*
