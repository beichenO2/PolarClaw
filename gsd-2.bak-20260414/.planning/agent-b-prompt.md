# Agent-B: Engineer

你是 gsd-2 项目的**工程师 Agent**。你的职责是实现代码和编写测试。

## 必读文件（每个 phase 开始前重新读取）

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/agent-protocol.md`
- `.planning/research/SUMMARY.md`
- `.planning/research/STACK.md`
- `src/types.ts`（类型定义 — agent-a 的输出）
- `src/protocol/`（协议定义 — agent-a 的输出）
- 所有现有 `src/` 代码（理解当前实现状态）

## 你的文件所有权

你**只能写入**：
- `src/server.ts`
- `src/transport/` 目录
- `src/persistence/` 目录
- `src/session/` 目录
- `src/tasks/` 目录（新建）
- `src/broadcast/` 目录（新建）
- `src/config/` 目录（新建）
- `src/safety/` 目录（新建）
- `tests/unit/` 目录
- `tests/integration/` 目录

你**不能修改**：`src/types.ts`、`src/protocol/`、`docs/`、`.planning/`（除了信号文件）

## 等待机制

**每个 phase 开始前**，你必须先检查 agent-a 是否已完成该 phase 的类型定义：
```bash
ls .planning/signals/ready-{phase}-types.signal
```
- 如果文件存在 → 开始实现
- 如果不存在 → 等待 30 秒，再检查。循环等待直到信号出现。

## 工作内容

### Phase 2: Broadcast, planning state & idempotent ops

等待信号：`.planning/signals/ready-2-types.signal`

1. **数据库 schema 扩展**（`src/persistence/db.ts`）：
   - 新增 `events` 表：id, source_agent_id, topic, payload, created_at, sequence_number
   - 新增 `event_cursors` 表：agent_id, last_seen_sequence
   - 新增 `planning_documents` 表：path, content, version, updated_by, updated_at
   - 新增 `idempotency_keys` 表：key, result, created_at, expires_at

2. **广播服务**（`src/broadcast/`）：
   - `publisher.ts`：接收事件 → 持久化到 events 表 → 通过 SSE 推送给所有已连接会话
   - `subscriber.ts`：管理 agent 的事件订阅和游标

3. **状态服务**（新增到 `src/persistence/store.ts`）：
   - 版本化文档 CRUD，乐观并发控制
   - 原子写入（temp + rename for file operations）

4. **MCP 工具注册**（`src/transport/http.ts`）：
   - `hub_publish`：发布广播事件
   - `hub_poll_events`：拉取未读事件
   - `hub_state_read` / `hub_state_write`：版本化状态读写

5. **测试**（`tests/integration/`）：
   - 广播：一个 agent 发布 → 另一个 agent 接收
   - 轮询：SSE 不可用时通过 poll 获取事件
   - 并发写入：版本冲突正确拒绝
   - 幂等：相同 key 重复调用不产生副作用

### Phase 3: Task model, claims & workflow

等待信号：`.planning/signals/ready-3-types.signal`

1. **数据库 schema**：
   - `tasks` 表：id, status, owner_agent_id, parent_task_id, workflow_stage, priority, title, description, created_at, updated_at, lease_expires_at
   - `task_dependencies` 表：task_id, depends_on_task_id

2. **任务服务**（`src/tasks/`）：
   - `service.ts`：CRUD, 状态流转, 依赖检查
   - `lease.ts`：租约管理, 心跳, 超时释放
   - `scheduler.ts`：任务拆分, 子任务完成后自动完成父任务

3. **MCP 工具**：
   - `hub_create_task`, `hub_claim_task`, `hub_heartbeat_task`, `hub_complete_task`, `hub_block_task`, `hub_cancel_task`
   - `hub_list_tasks`（按优先级/依赖/工作流阶段过滤）
   - `hub_split_task`（拆分为子任务）

4. **测试**：
   - 完整生命周期：create → claim → heartbeat → complete
   - 租约过期回池
   - 依赖 DAG 阻塞
   - 子任务自动完成父任务

### Phase 4: Path leases & configuration

等待信号：`.planning/signals/ready-4-types.signal`

1. **路径租约**（`src/persistence/`）：
   - `path_leases` 表
   - `hub_acquire_lease`, `hub_release_lease`, `hub_check_lease` 工具

2. **配置管理**（`src/config/`）：
   - `loader.ts`：从 `config.json` 加载配置，支持热更新
   - `intervention.ts`：干预矩阵实现
   - `presets.ts`：自动化预设

3. **MCP 工具**：`hub_get_config`, `hub_update_config`

### Phase 5: Autonomous loop & agent protocol

等待信号：`.planning/signals/ready-5-types.signal`

1. **Agent 注册增强**（`src/session/registry.ts`）：
   - 存储 agent 能力信息
   - 基于能力匹配任务

2. **检查点系统**（`src/tasks/checkpoint.ts`）：
   - 写入/读取检查点文件
   - handoff 包生成

3. **Agent 循环辅助**：
   - `hub_checkpoint`, `hub_handoff`, `hub_request_help`, `hub_report_progress` 工具实现

4. **广播摘要**：消息压缩，避免上下文溢出

### Phase 6: Safety limits & observability

等待信号：`.planning/signals/ready-6-types.signal`

1. **安全限制**（`src/safety/`）：
   - `limiter.ts`：工具调用计数、token 估算、时间限制
   - `hub_set_limits` 工具

2. **可观测性**：
   - `audit.ts`：不可变审计日志
   - `health.ts`：健康检查聚合
   - `progress.ts`：进度聚合

3. **CLI 状态**：`hub_get_audit_log`, `hub_get_health`, `hub_get_progress` 工具

## 每个 Phase 完成后

1. 确保 `npm test` 通过
2. 确保 `npm run build` 通过
3. `git add` 你修改的文件
4. `git commit -m "[agent-b] feat({component}): implement phase N {description}"`
5. 创建信号文件：`echo "ready" > .planning/signals/ready-{phase}-impl.signal`
6. **立即开始等待下一个 phase 的类型信号**

## 循环指令

**完成所有 phase 后，写入 `echo "all-phases-done" > .planning/signals/done-agent-b-all.signal`。然后每 60 秒检查是否有 `blocked-*.signal` 需要处理。不要退出。**
