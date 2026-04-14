# 外部项目调研 — 2026-04-10

## 1. letta-ai/agent-file (.af 格式)

**项目**: Agent File — 开放的 AI Agent 状态序列化标准

**核心理念**: State Externalization（状态外部化）— Agent 应将状态持久化到文件/数据库，而非依赖易失的 context window。

**对 gsd-2 的启发**:

| 当前 gsd-2 做法 | agent-file 做法 | 改进方向 |
|---|---|---|
| Agent 死亡时 checkpoint 存到 Hub 数据库 | 完整状态打包为 `.af` 文件（model config + message history + memory blocks + tool configs） | 扩展 checkpoint 格式：不仅保存"做到哪了"，还保存 agent 的行为模式和工具配置 |
| 继任者只拿到前任的 stateSnapshot（JSON blob） | 继任者拿到完整的 `.af` 文件，包含 in_context 标志标注哪些消息还在 context window 内 | 为 stateSnapshot 增加结构化 schema，区分"核心记忆"和"可丢弃的历史" |
| 没有跨框架可移植性 | `.af` 文件可在不同框架间传递 | 不需要，gsd-2 只用 Cursor CLI |

**可行改进**:
- 为 `hub_checkpoint` 增加结构化 schema（当前是任意 JSON）
- 增加 "memory blocks" 概念：将 agent 的模块知识、任务上下文分块保存
- 继任者 prompt 中注入前任的核心记忆块，而不是整个 snapshot

---

## 2. camel-ai/owl（OWL: Optimized Workforce Learning）

**项目**: GAIA 基准测试第一的开源通用 AI Agent 框架

**核心理念**: Dynamic Coordination（动态协调）— Agent 通过自然语言通信协调，而非预定义状态机。

**对 gsd-2 的启发**:

| 当前 gsd-2 做法 | OWL 做法 | 改进方向 |
|---|---|---|
| 固定角色（proxy/ctrl/super/worker） | 专业化 Agent 角色（planner/web agent/document agent/coding agent） | gsd-2 的角色划分已经不错，可以考虑增加更细粒度的 worker 专业化 |
| 消息总线 + 固定 topic | 信息流编排（orchestrator 监控任务进度，用自然语言协调） | gsd-2 已有类似机制（ctrl 通过 Hub 分发），但可以让 ctrl 更"智能"地调度而非按固定模式 |
| 30+ 模块亲和性 | 30+ 工具包集成 | gsd-2 的 agent 可以使用 Cursor 的所有工具，不需要额外集成 |

**可行改进**:
- 让 controller 的任务分配更智能：根据 worker 的历史表现（完成速度、成功率）调整分配
- 增加 "planner" 角色概念：controller 不仅分发任务，还主动规划任务依赖和并行度
- 研究 OWL 的 tool-driven collaboration 模式，看能否用于 worker 间的隐式协作

---

## 3. simstudioai/sim（Sim Studio）

**项目**: 可视化 AI Agent 工作流构建和测试平台

**核心理念**: Visual Workflow Editor — 拖拽式构建 + 实时测试 + 部署为 API

**对 gsd-2 的启发**:

| 当前 gsd-2 做法 | Sim Studio 做法 | 改进方向 |
|---|---|---|
| 通过 prompt 模板描述工作流 | 拖拽式 DAG 可视化编辑 | 可以用 Sim Studio 做 gsd-2 工作流的可视化监控面板 |
| `cluster-status.sh` 文字输出 | 实时可视化仪表板 + 执行追踪 | 开发一个简单的 Web 监控页面（读 Hub SQLite） |
| 没有工作流模拟验证 | 可以在画布上测试运行，检查每个节点的输入输出 | 创建 dry-run 模式：模拟 Agent 交互流程而不实际启动 CLI |

**可行改进**:
- 短期：开发一个 HTML 监控页面，从 Hub SQLite 读取数据展示实时状态
- 中期：增加 dry-run 模式（`--dry-run` flag），模拟 Agent 消息流转验证流程
- 长期：考虑用 Sim Studio 做 gsd-2 的可视化编排前端

---

## 行动建议优先级

1. **短期（本轮）**: 扩展 checkpoint schema + agent-state 状态文件（已在 launcher 修复中部分实现）
2. **中期**: 开发 Web 监控面板 + 改进 controller 智能调度
3. **长期**: 研究 OWL 的动态协调模式，评估是否值得重构 gsd-2 的编排架构
