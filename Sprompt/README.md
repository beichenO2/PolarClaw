# Sprompt/ — CLAW System Prompt & Spec Folder

**版本：v0.1 baseline**  
**创建时间：2026-03-18**

这是 CLAW 系统的 prompt/spec 文件夹，存放系统级规范、角色定义、通信协议、JSON schema 和迁移说明。

---

## 快速定位

| 我想找什么 | 去哪里 |
|-----------|--------|
| 系统是什么，总体架构 | `constitutional/00_overview.md` |
| 每一层的职责和边界 | `constitutional/01_layered_architecture.md` |
| 系统硬约束（不可绕过的规则）| `constitutional/02_constraints.md` |
| 用户输入如何被标准化 | `constitutional/03_intake_policy.md` |
| 层间如何通信（wait gate 等）| `constitutional/04_communication_policy.md` |
| 如何操作 docs/ 文件 | `operational/01_docops_policy.md` |
| 如何收集执行证据 | `operational/02_evidence_collection_contract.md` |
| Validator 如何判定 | `operational/03_validator_spec.md` |
| 接口变更如何走流程 | `operational/04_interface_change_gate.md` |
| 白名单如何控制文件权限 | `operational/05_whitelist_policy.md` |
| task_contract 的 schema | `schemas/task_contract.json` |
| evidence_pack 的 schema | `schemas/evidence_pack.json` |
| validation_report 的 schema | `schemas/validation_report.json` |
| CLAW 的 role prompt | `prompts/roles/CLAW.md` |
| Project Executor 的 role prompt | `prompts/roles/project_executor.md` |
| 三层闭环的每个角色 prompt | `prompts/roles/evidence_collector.md`, `prompts/roles/deterministic_validator.md` |
| 样例文件 | `examples/` |
| 老项目资产怎么迁移的 | `migration/legacy_asset_mapping.md` |
| 待解决的问题 | `notes/open_questions.md` |
| 谁可以修改哪些文件 | `notes/iteration_strategy.md` |

---

## Folder Tree

```
Sprompt/
├── README.md                          ← 本文件
│
├── constitutional/                    ← A 类：系统宪法层（修改需人工审阅）
│   ├── 00_overview.md                 系统总览、硬规则、主链路
│   ├── 01_layered_architecture.md     分层架构详细定义
│   ├── 02_constraints.md              系统级永久约束（Execution Constitution）
│   ├── 03_intake_policy.md            用户输入规范化策略
│   └── 04_communication_policy.md    层间通信协议（wait gate/escalation/human_action）
│
├── operational/                       ← B 类：运行规范（修改需 Validator+review）
│   ├── 01_docops_policy.md            文档操作规范（docs/ 使用规范）
│   ├── 02_evidence_collection_contract.md  证据收集合同
│   ├── 03_validator_spec.md           Deterministic Validator 规范
│   ├── 04_interface_change_gate.md    接口变更门控流程
│   └── 05_whitelist_policy.md         白名单文件控制规范
│
├── schemas/                           ← B 类：JSON Schema 定义
│   ├── task_contract.json             CLAW 向 Executor 传递的任务对象
│   ├── mode_selection.json            Mode 选择结果对象
│   ├── bot_run_plan.json              Executor 制定的执行计划
│   ├── agent_task.json                FSM 向 Agent 分配的子任务
│   ├── agent_result.json              Agent 的执行结果
│   ├── evidence_pack.json             Evidence Collector 组装的证据包
│   ├── validation_report.json         Validator 的判定报告
│   ├── human_action_request.json      人工操作请求（分类枚举）
│   ├── interface_change_proposal.json 接口变更提案
│   ├── blocked_task_state.json        任务阻塞状态快照
│   ├── wait_gate_event.json           Wait Gate 事件
│   └── escalation_request.json        上报请求
│
├── prompts/
│   └── roles/                         ← B 类：角色 prompt 文件
│       ├── CLAW.md                    系统顶层治理与编排
│       ├── mode_selector.md           Mode 分析与推荐
│       ├── project_executor.md        project_mode 执行主体
│       ├── knowledge_executor.md      knowledge_mode 执行主体
│       ├── generic_agent.md           通用 Agent（执行子任务）
│       ├── evidence_collector.md      三层闭环第二层：证据收集
│       └── deterministic_validator.md 三层闭环第三层：确定性判定
│
├── examples/                          ← C 类：运行时样例（可自动生成）
│   ├── task_contract_sample.json      S2 任务的 task_contract 样例
│   ├── evidence_pack_sample.json      S1 验证的 evidence_pack 样例
│   ├── validation_report_sample.json  S1 验证的 validation_report 样例
│   └── interface_change_proposal_sample.json  S2 接口变更提案样例
│
├── migration/
│   └── legacy_asset_mapping.md        ← 老项目资产迁移说明与映射
│
└── notes/
    ├── open_questions.md              ← 待解决的设计问题（Q-001 至 Q-010）
    └── iteration_strategy.md          ← 自我迭代策略与权限边界
```

---

## 关键约束速查

1. **Non-Fabrication**：未知值写 TBD，禁止猜测，禁止提前打 [x]
2. **三层闭环**：Worker → Evidence Collector → Deterministic Validator（不可跳过）
3. **白名单**：Agent 只能修改 editable_scope 中的文件，禁止通配符
4. **接口变更门控**：发现接口变更 → 停止 → 生成 proposal → 等审批
5. **docs 备份**：修改 docs 文件前必须先创建 .bak
6. **权威顺序**：state.md > interfaces.md > decisions.md > roadmap.md
7. **下游不消费原始 prompt**：下游只接收结构化 task_contract

---

## 待完成事项（来自 notes/open_questions.md）

高优先级：
- Q-003: FSM 详细定义（`operational/fsm/` 目录）

中优先级：
- Q-001: Mode Registry 注册表
- Q-002: Pattern 格式标准化（`operational/patterns/` 目录）
- Q-004: run_result schema
- Q-006: CLAW 层 session 定义
- Q-009: knowledge_mode 验证策略
- Q-010: web_ui_spec.md

---

*文件分类：Notes/Index（记录性，无分类限制）*  
*版本：v0.1 baseline*
