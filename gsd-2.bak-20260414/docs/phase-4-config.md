# Phase 4: 路径租约与配置（Path Leases & Configuration）

## 路径租约

避免多 Agent 同时改写同一文件：在编辑前通过 Hub 申请**互斥路径租约**（带 TTL）。

### `hub_acquire_lease`

| 字段 | 说明 |
|------|------|
| `agent_id` | 当前会话注册 id |
| `path` | 逻辑路径（建议与仓库内路径一致，如 `src/foo.ts`） |
| `ttl_ms` | 可选；省略时使用 `config.json` 的 `default_lease_ttl_ms`，再否则内置默认值 |
| `idempotency_key` | 可选 |

响应为判别联合：

- **`status: "granted"`** — `lease` 含 `lease_id`、`expires_at` 等。
- **`status: "conflict"`** — 路径已被他人持有；**`holder`** 描述当前持有者（用于明确冲突信号）。

同一 agent 对已持有路径再次 acquire 会延长租约。

### `hub_release_lease`

按 `lease_id` 或 `path` 释放（必须本人持有）。

### `hub_check_lease`

查询某路径当前有效租约（无则 `lease: null`）。

## 配置 `config.json`

Hub 将工作区根目录（默认 mirror/`process.cwd()`）下的 **`config.json`** 视为自动化偏好来源。

### `hub_get_config`

读取并解析当前磁盘上的配置（若不存在会按默认预设生成一份）。

### `hub_update_config`

乐观并发更新：

| 字段 | 说明 |
|------|------|
| `agent_id` | 当前 agent |
| `expected_version` | 必须与当前 `config.version` 一致 |
| `patch` | 部分字段；可更新 `automation_preset`、`intervention_matrix`、`default_lease_ttl_ms`、`default_task_lease_ms`、`workspace_root` 等 |

- 若 `expected_version` 不匹配 → **`status: "conflict"`** 并返回当前 `config`。
- 成功时版本号自增，`automation_preset` 变更会按预设刷新干预矩阵（除非同时显式传入矩阵补丁）。

### 干预矩阵（`intervention_matrix`）

每个 GSD 阶段（`discuss` … `verify`）取值：**`auto`** | **`notify`** | **`block`**。  
预设 **`full_auto` / `semi_auto` / `interactive`** 可通过 `hub_update_config` 切换（见 `src/config/presets.ts`）。

### 热更新

MCP 工具在需要时调用 **`loadConfigFromDisk`** 重新读盘（例如 `hub_acquire_lease` 解析默认 TTL）。因此**直接编辑 `config.json` 保存后**，下一次相关工具调用即可看到新值，无需重启 Hub 进程（生产入口还可额外通过 `watchConfig` 打日志）。

## E2E

`tests/e2e/leases-config.test.ts`：租约冲突、`default_lease_ttl_ms` 生效、预设/矩阵落盘、手工改文件后 `hub_get_config` 可见。

## 相关代码

- `src/persistence/path-leases.ts`、`src/protocol/leases.ts`
- `src/config/loader.ts`、`src/config/presets.ts`、`src/protocol/config.ts`
- `src/transport/http.ts` — `hub_*` 工具
