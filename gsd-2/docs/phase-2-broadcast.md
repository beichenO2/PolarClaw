# Phase 2: 广播与规划状态（Broadcast & Planning State）

本文说明 gsd-2 Hub 的**事件广播**（SSE 实时推送 + `hub_poll_events` 轮询回退）以及 **`.planning/` 权威状态**（版本化文档、乐观并发、原子镜像、幂等工具调用）。

## 前置条件

- Hub 以 Streamable HTTP 运行（默认 `http://127.0.0.1:8765/mcp`，环境变量见 `GSD_HUB_HOST` / `GSD_HUB_PORT` / `GSD_HUB_DB`）。
- 每个 MCP 会话必须先调用 `hub_register`，绑定稳定的 `agent_id`。

## 广播 API

### `hub_publish`

向所有订阅者投递**持久化**事件，并推送到当前 SSE 连接。

| 字段 | 说明 |
|------|------|
| `agent_id` | 必须与当前会话注册一致 |
| `topic` | 事件主题 |
| `payload` | 任意 JSON 可序列化数据 |
| `idempotency_key` | 可选；相同 key 的重复调用只生效一次，响应中带 `deduplicated: true` |

### SSE 订阅

对已注册的会话，使用 GET：

```http
GET /hub/events/stream?mcp_session_id=<当前 MCP session id>
```

响应为 `text/event-stream`。首条可能是注释行 `: connected`，后续 `data:` 行为 JSON 事件（含 `topic`、`agent_id`、`payload` 等）。

**注意：** `mcp_session_id` 来自 `hub_register` 返回的 `session_id`（即 MCP 传输层会话 id）。同一 `agent_id` 重连后会话 id 会更新，SSE URL 需使用最新值。

### `hub_subscribe`（可选）

按 `topics` 过滤本 agent  durable / SSE 投递；空数组表示不过滤。

### `hub_poll_events`（轮询回退）

当 SSE 不可用或漏消息时，用持久化事件日志 + 每 agent 游标拉取：

```json
{
  "agent_id": "my-agent",
  "after_event_id": "可选，上一批最后一条事件 id",
  "limit": 50
}
```

返回 `events` 与可选 `cursor`（最后一条 id）。Hub 会按 agent 维护「已读」序列，断线重连后用同一 `agent_id` 再次 `hub_register`，再 `hub_poll_events` 即可补齐离线期间事件。

## 状态管理 API（`.planning/` 权威）

规划文档由 Hub 持久化，并在配置的 `mirrorRoot`（通常为进程 `cwd`）下做**原子写入**（临时文件 + rename），路径应在 `.planning/` 下。

### `hub_state_read`

```json
{ "path": ".planning/STATE.md" }
```

返回 `document`（`content`、`version`、`updated_by`、`updated_at`）或 `null`。

### `hub_state_write`

乐观并发：

| 字段 | 说明 |
|------|------|
| `path` | 文档路径 |
| `content` | 新全文 |
| `expected_version` | 期望当前版本；`0` 表示创建 |
| `updated_by` | **必须等于**当前会话的 `agent_id` |
| `idempotency_key` | 可选；成功写入后重复相同 key 返回相同 `result`，不重复写盘 |

成功时 `result.status === "success"` 并带新 `version`；与当前版本不符时为 `"conflict"`。

## 操作建议

1. 启动后先 `hub_register`，再 publish / read / write。
2. 需要实时性时开 SSE；网络或客户端限制时主用 `hub_poll_events`，并用返回的 `cursor` / `after_event_id` 增量拉取。
3. 多 agent 写同一文件时，先 `hub_state_read` 拿 `version`，再带 `expected_version` 写入；冲突时重新读、合并、重试。
4. 对「可能重试」的工具调用（网络抖动、用户重复点击）带上统一的 `idempotency_key`。

## 相关实现位置（只读参考）

- 工具注册：`src/transport/http.ts`
- 协议类型：`src/protocol/broadcast.ts`、`src/protocol/state.ts`
- 广播与 SSE：`src/broadcast/`
- 持久化与游标：`src/persistence/store.ts`

E2E 验证见 `tests/e2e/broadcast.test.ts` 与 `tests/integration/phase2.integration.test.ts`。
