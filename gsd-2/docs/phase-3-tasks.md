# Phase 3: 任务模型、认领与工作流（Tasks）

本文说明 gsd-2 Hub 的**任务**工具：创建、带租约认领、心跳续期、完成/阻塞/取消、依赖（DAG）、拆分（子任务全完成后父任务自动完成）以及按 **GSD 工作流阶段**（discuss / research / plan / execute / verify）过滤。

## 通用约定

- 所有工具调用前需 **`hub_register`**，且参数中的 `agent_id` / `creator_agent_id` / `updated_by` 等必须与当前会话绑定的一致。
- 任务在存储层包含 `title` / `description` 等字段，但 **MCP 返回的 `task` 对象**（`src/types.ts` 的 `Task`）仅暴露调度所需字段；如需标题等，可用 **`hub_list_tasks`** 结合筛选（当前列表结果仍以 DB 行为为准；协议层若扩展字段以 `src/protocol/tasks.ts` 为准）。

## 任务生命周期工具

### `hub_create_task`

| 字段 | 说明 |
|------|------|
| `creator_agent_id` | 必须等于当前注册 agent |
| `title` | 必填 |
| `workflow_stage` | GSD 阶段标签 |
| `priority` | 整数，越大越优先被认领 |
| `depends_on` | 可选，上游任务 id 列表；未完成时下游保持不可认领 |
| `parent_task_id` | 可选，挂到已有父任务下 |
| `idempotency_key` | 可选，重复创建返回同一任务 |

### `hub_claim_task`

认领「下一个」**就绪**任务（依赖已满足、`open` 状态）。内部会在认领前 **释放已过期的租约**（将任务设回 `open`）。

| 字段 | 说明 |
|------|------|
| `agent_id` | 当前 agent |
| `lease_duration_ms` | 租约时长（默认 600000 ms） |
| `heartbeat_interval_ms` | 文档/客户端侧节拍参考（服务端以 `hub_heartbeat_task` 为准） |
| `workflow_stage` | 可选，只认领该阶段的 `open` 任务 |

若无可用任务，返回 `task: null`。

### `hub_heartbeat_task`

延长当前认领任务的租约（需在 `claimed` 且 `owner` 匹配）。

### `hub_complete_task`

将任务标为 `done`，释放租约；若该任务是子任务，会触发 **`maybeAutocompleteParent`**：当同一父任务下所有子任务均为 `done` 时，父任务自动 `done`（可递归向上）。

### `hub_block_task` / `hub_cancel_task`

将任务置为 `blocked` 或 `cancelled`，并释放租约（所有者需匹配或为空）。

### `hub_list_tasks`

| 字段 | 说明 |
|------|------|
| `status` | 按状态过滤 |
| `workflow_stage` | 按阶段过滤 |
| `owner_agent_id` | 按持有者过滤 |
| `ready_only` | `true` 时仅保留 **依赖已满足** 的 `open` 任务（用于观察「可认领队列」） |
| `limit` | 最大条数 |

### `hub_split_task`

在父任务下批量创建子任务。父任务在拆分后仍为 `open`；**认领调度按 `priority` 排序**——若父与子同为默认优先级，父可能先于子被认领。实践中可为子任务设置 **高于父任务** 的 `priority`，或先处理高优先级子任务。子任务全部 `done` 后父任务自动 `done`（见上）。

## 租约与「回到池中」

- 认领时写入 `lease_expires_at`。
- 每次 `hub_claim_task` 开头调用 **`releaseExpiredTaskLeases`**：已到期的 `claimed` 任务重置为 `open`，`owner` 清空。
- Agent 应在过期前调用 **`hub_heartbeat_task`** 续期。

## E2E

详见 `tests/e2e/tasks.test.ts`（生命周期、租约过期、依赖、`hub_split_task` + 父任务自动完成、按 `workflow_stage` 认领）。

## 相关代码（只读）

- `src/tasks/service.ts` — 任务核心逻辑
- `src/tasks/lease.ts` — 过期租约释放
- `src/tasks/scheduler.ts` — 父任务自动完成
- `src/transport/http.ts` — MCP 工具绑定
