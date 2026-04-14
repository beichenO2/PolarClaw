# Phase 5: 自治循环与 Agent 协议（Autonomy & Handoff）

## 核心工具

### `hub_register`

- 绑定 `agent_id` 与 MCP `session_id`（重连时更新绑定）。
- 可选 `roles` / `skills` 数组：写入 Hub 能力表，供后续任务路由使用。
- 会产生审计记录 `hub.register`（见 Phase 6 `hub_get_audit_log`）。

### `hub_checkpoint`

将可恢复检查点写入 **`.planning/hub/checkpoints/<agent_id>_<task_id>.json`**（原子写）。

| 字段 | 说明 |
|------|------|
| `progress_summary` | 简短进度描述 |
| `context_snapshot` | 任意 JSON（文件列表、步骤号等） |
| `idempotency_key` | 可选 |

### `hub_handoff`

读取上述检查点并打包 `package`：**`task_id`**、**`checkpoint`**（含 ISO `timestamp`）、**`remaining_steps`**（由当前任务元数据推导的提示句）、**`artifacts`**。  

**重要：** 检查点文件按 **`agent_id` + `task_id`** 命名。新会话若需接续同一工作者，应使用 **相同的稳定 `agent_id`** 调用 `hub_register`，再调用 `hub_handoff`。

### `hub_report_progress`

自治循环状态机：`started` / `progress` / `done` / `error`。  
`progress` 会增加内部 **iteration** 计数；`error` 将状态标为 `error`，后续 `progress` 可表示“恢复/重试”。

### `hub_request_help`

发布 **广播事件**，`topic` 为 `help.<topic>`，`payload` 含 `summary`、`task_id` 等（见 `hub_poll_events` / SSE）。

## 推荐循环（概念）

1. `hub_register`  
2. `hub_claim_task`（或创建任务后再认领）  
3. `hub_report_progress` (`kind: "started"`)  
4. 执行本地工作… 期间 `hub_checkpoint`、多次 `hub_report_progress` (`progress`)  
5. `hub_complete_task`  
6. `hub_report_progress` (`kind: "done"`)

断线恢复：同一 `agent_id` 重连 → `hub_handoff` 拉包 → 继续认领或完成。

## E2E

见 `tests/e2e/agent-loop.test.ts`。

## 相关代码

- `src/tasks/checkpoint.ts` — 检查点落盘  
- `src/tasks/progress.ts` — `ProgressTracker`  
- `src/protocol/agent.ts` — 输入 schema  
- `src/transport/http.ts` — MCP 注册  
