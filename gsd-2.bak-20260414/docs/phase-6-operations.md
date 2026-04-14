# Phase 6: 安全上限与可观测性（Safety & Operations）

## 每 Agent 上限：`hub_set_limits`

| 字段 | 说明 |
|------|------|
| `limits.max_tool_calls` | 单次循环允许的工具调用次数上限（由 `SafetyLimiter` 跟踪） |
| `limits.max_tokens` | Token 用量上限（估计值累加） |
| `limits.max_wall_time_ms` | 壁钟时间上限 |

可选 `expected_version` 与幂等键；返回 `success` 或 `conflict`（与已持久化版本不一致时）。

**说明：** 当前仓库中 **`SafetyLimiter.check` / `recordToolCall` 需在 MCP 工具链中统一挂钩** 后才能从客户端感知「超上限拒绝」。`tests/e2e/safety-obs.test.ts` 内含对 `SafetyLimiter` 类的直接行为断言，用于在挂钩前锁定语义。

## 审计：`hub_get_audit_log`

追加式审计表，常见 `action` 包括 `hub.register`、`hub.set_limits` 等。支持 `after_id` 游标与 `agent_id` / `task_id` 过滤。

## 健康：`hub_get_health`

返回：

- `stale_agents`：`last_ping_at` 早於默认 **120s** 窗口的已注册 Agent（见 `buildHealthStatus`）。
- `queue_depth`：未消费 durable 消息数。
- `active_tasks`：状态为 `claimed` 的任务数。
- `anomalies`：启发式告警（如消息积压过大）。

## 进度聚合：`hub_get_progress`

按 **workflow_stage** 汇总任务完成度与队列活跃度（`buildProgressByPhase`）。

## CLI / 运维

- Hub 进程日志：生产入口使用 **pino**（环境变量 `LOG_LEVEL`）。
- `hub_get_*` 工具可作为无 GUI 运维面；若需 shell 一行式封装，可在后续通过 `npm run` 或薄 CLI 调用同一 SQLite / HTTP。

## E2E

`tests/e2e/safety-obs.test.ts`：审计、`hub_set_limits`、进度聚合、**陈旧 Agent**（停库后改写 `sessions.last_ping_at` 再启动）、`SafetyLimiter` 调用上限、`hub_get_health` 响应结构。

## 相关代码

- `src/safety/limiter.ts`、`src/safety/audit.ts`、`src/safety/health.ts`、`src/safety/progress.ts`
- `src/protocol/safety.ts`
- `src/persistence/db.ts` — `audit_log`、`agent_safety_limits` 表
