# Requirements: gsd-2

**Defined:** 2026-04-07
**Core Value:** 多个独立 AI Agent 能像一个团队一样自治协作——无需人类持续驱动

## v1 Requirements

### MCP Hub（通信中枢）

- [ ] **HUB-01**: MCP Server 以 Streamable HTTP 模式运行，支持多个 Cursor Agent 同时连接为独立会话
- [ ] **HUB-02**: 每个 Agent 连接时获得稳定的 agent_id 和 session_id，用于路由和审计
- [ ] **HUB-03**: Hub 持久化消息到磁盘（SQLite 或文件），Agent 断线重连后可恢复未处理消息
- [ ] **HUB-04**: 支持广播消息：一个 Agent 发布的事件通过 SSE 推送给所有已连接 Agent
- [ ] **HUB-05**: 支持 poll 回退：当 SSE 不可用时，Agent 可通过工具调用轮询获取新事件
- [ ] **HUB-06**: Hub 崩溃重启后能恢复状态，不丢失任务和消息（crash-safe）

### Task（任务管理）

- [ ] **TASK-01**: 任务记录包含 id、状态、owner、创建/更新时间戳，状态流转：open → claimed → done/blocked/cancelled
- [ ] **TASK-02**: Agent 通过 MCP 工具 claim 任务，获得限时租约（lease），超时未心跳自动释放
- [ ] **TASK-03**: 支持任务依赖关系（DAG），被依赖任务完成前阻塞下游任务
- [ ] **TASK-04**: 支持任务拆分：一个大任务可分解为多个子任务，子任务全部完成后父任务自动标记完成
- [ ] **TASK-05**: Agent 可通过 MCP 工具查询可用任务列表（按优先级/依赖排序）
- [ ] **TASK-06**: 任务与 GSD 工作流阶段关联（discuss/research/plan/execute/verify）

### STATE（状态与协调）

- [ ] **STATE-01**: 项目状态持久化到 .planning/ 目录，作为所有 Agent 的唯一事实来源
- [ ] **STATE-02**: 状态文档带版本号，Agent 更新时进行乐观并发控制（版本冲突时拒绝并通知）
- [ ] **STATE-03**: 文件级路径租约：Agent 编辑文件前必须通过 Hub 获取租约，避免并发写入冲突
- [ ] **STATE-04**: 原子写入：所有文件操作通过 temp + rename 模式，防止写一半的损坏文件
- [ ] **STATE-05**: 所有 Hub 操作幂等：重复的工具调用不产生副作用

### AUTO（自治运行）

- [ ] **AUTO-01**: Agent 运行"获取任务→执行→报告→等待"循环，通过 MCP 工具驱动
- [ ] **AUTO-02**: Agent 在每个循环迭代结束时写入检查点文件，记录当前进度和上下文摘要
- [ ] **AUTO-03**: 新 Agent 会话可读取检查点继续前一会话的工作（handoff）
- [ ] **AUTO-04**: 租约过期的任务自动回到任务池，供其他 Agent 认领
- [ ] **AUTO-05**: 重试机制：临时失败自动重试（指数退避），超过最大次数后标记任务 blocked 并通知
- [ ] **AUTO-06**: 硬性安全上限：单个 Agent 单次循环的工具调用次数、总 token 消耗、运行时间均可配置上限

### CONFIG（配置与偏好）

- [ ] **CONF-01**: 项目初始化时一次性收集所有配置偏好，持久化到 config.json
- [ ] **CONF-02**: 干预矩阵：用户可配置每个工作流阶段是「自动」「通知」还是「阻塞等待审批」
- [ ] **CONF-03**: Agent 运行时从 config.json 读取偏好，不再向用户提问已配置的原则问题
- [ ] **CONF-04**: 配置支持热更新：修改 config.json 后 Agent 下次循环自动生效
- [ ] **CONF-05**: 自动化级别预设：提供「全自动」「半自动」「交互式」预设，用户可基于预设微调

### OBS（可观测性）

- [ ] **OBS-01**: 所有 Hub 操作记录结构化日志（pino），包含 agent_id、task_id、correlation_id
- [ ] **OBS-02**: 不可变事件日志：所有任务状态变更、消息发布、租约操作追加到审计日志
- [ ] **OBS-03**: 进度聚合：可查询当前 phase 完成度、活跃 Agent 数量、任务队列深度
- [ ] **OBS-04**: 健康信号：检测长时间无心跳的 Agent、积压任务、循环异常
- [ ] **OBS-05**: CLI 状态命令：通过命令行查看系统状态（替代 v1 不做的 GUI 仪表盘）

### AGENT（Agent 协议）

- [ ] **AGNT-01**: 提供标准 Agent 引导 prompt/规则文件，Agent 加载后即知道如何与 Hub 交互
- [ ] **AGNT-02**: Agent 首次连接时向 Hub 注册身份和能力，Hub 据此分配适合的任务
- [ ] **AGNT-03**: Agent 执行任务时通过 MCP 工具报告进度（started/progress/done/error）
- [ ] **AGNT-04**: Agent 间可通过 Hub 广播请求协助或报告发现的问题
- [ ] **AGNT-05**: Agent 收到的广播消息为摘要格式，避免上下文窗口被大量原始消息填满

## v2 Requirements

### 高级协调

- **ADV-01**: CRDT 或智能合并策略，支持多 Agent 同时编辑同一文件的不同区域
- **ADV-02**: 事件回放和模拟，用于调试和优化 Agent 协作策略
- **ADV-03**: 丰富的角色体系（lead、reviewer、specialist），按角色能力分配任务
- **ADV-04**: 策略包（可分享的配置模板），团队间共享工作流偏好

### 扩展支持

- **EXT-01**: Claude Code 适配器
- **EXT-02**: 其他 IDE 适配器框架
- **EXT-03**: Web 管理仪表盘
- **EXT-04**: CI/CD 集成，无头模式运行

### 智能化

- **INT-01**: 基于历史数据的任务估时和 Agent 匹配优化
- **INT-02**: 自愈剧本：Agent 遇到常见错误时自动执行修复流程
- **INT-03**: 学习型配置：根据项目进展自动调整自动化级别

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fork 或 import GSD-1 代码 | 架构差异太大，独立重写更干净 |
| v1 图形化管理界面 | CLI + MCP 交互足够，GUI 延迟到 v2+ |
| 同时支持多 IDE | v1 只保证 Cursor，架构预留扩展点 |
| 自训练 AI 模型 | 使用现有 LLM API |
| 社交聊天功能 | 工程协调工具，不是通讯软件 |
| 后台守护进程 | 不假设 Agent 是持久后台进程，循环在 IDE 会话内运行 |
| 无限制的破坏性操作 | 安全门控：危险操作需配置许可 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HUB-01 | Phase 1 | Pending |
| HUB-02 | Phase 1 | Pending |
| HUB-03 | Phase 1 | Pending |
| HUB-04 | Phase 2 | Pending |
| HUB-05 | Phase 2 | Pending |
| HUB-06 | Phase 1 | Pending |
| TASK-01 | Phase 3 | Pending |
| TASK-02 | Phase 3 | Pending |
| TASK-03 | Phase 3 | Pending |
| TASK-04 | Phase 3 | Pending |
| TASK-05 | Phase 3 | Pending |
| TASK-06 | Phase 3 | Pending |
| STATE-01 | Phase 2 | Pending |
| STATE-02 | Phase 2 | Pending |
| STATE-03 | Phase 4 | Pending |
| STATE-04 | Phase 2 | Pending |
| STATE-05 | Phase 2 | Pending |
| AUTO-01 | Phase 5 | Pending |
| AUTO-02 | Phase 5 | Pending |
| AUTO-03 | Phase 5 | Pending |
| AUTO-04 | Phase 3 | Pending |
| AUTO-05 | Phase 5 | Pending |
| AUTO-06 | Phase 6 | Pending |
| CONF-01 | Phase 4 | Pending |
| CONF-02 | Phase 4 | Pending |
| CONF-03 | Phase 4 | Pending |
| CONF-04 | Phase 4 | Pending |
| CONF-05 | Phase 4 | Pending |
| OBS-01 | Phase 6 | Pending |
| OBS-02 | Phase 6 | Pending |
| OBS-03 | Phase 6 | Pending |
| OBS-04 | Phase 6 | Pending |
| OBS-05 | Phase 6 | Pending |
| AGNT-01 | Phase 5 | Pending |
| AGNT-02 | Phase 5 | Pending |
| AGNT-03 | Phase 5 | Pending |
| AGNT-04 | Phase 5 | Pending |
| AGNT-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 38 total (HUB 6 + TASK 6 + STATE 5 + AUTO 6 + CONF 5 + OBS 5 + AGNT 5)
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after roadmap creation*
