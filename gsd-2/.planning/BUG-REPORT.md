# gsd-2 Bug Report — 2026-04-10

## 环境

- 10 个项目同时运行（60 个 tmux session）
- 所有项目使用 gsd-2 v0.4.0
- 系统：Mac Studio, darwin 25.3.0

---

## Bug 1: Agent 快速退出后无限重启（P0）

**现象**: Agent 使用 `while true` + 固定 5s 间隔重启，当 Agent 因错误快速退出时（<2s），每 7 秒重启一次，疯狂消耗 API 配额。

**根因**: 
- `cursor agent --print` 是一次性模式，执行完 prompt 就退出
- 原始 launcher 使用固定 `sleep 5` 间隔的 `while true` 循环
- 没有指数退避——不管 Agent 运行了 2 小时还是 2 秒，都是等 5 秒重启
- 账单未付时，Agent 立即被拒绝并退出，导致每 7 秒一次的重启循环

**证据**: 
```
=== [worker-01] 退出，5s 后重启 ===
=== [worker-01] 启动 Fri Apr 10 08:36:19 CST 2026 ===
b: You have an unpaid invoice
=== [worker-01] 退出，5s 后重启 ===
=== [worker-01] 启动 Fri Apr 10 08:36:41 CST 2026 ===
```

**修复**: 
- launcher.sh 增加指数退避：正常退出(>2min)重置为 5s，快速退出(<2min)翻倍，最大 5min
- 增加快速重启限流：60s 内超过 10 次重启则强制休眠 5 分钟
- 增加 agent-state/*.json 状态追踪文件

---

## Bug 2: Proxy 重复创建 Agent（P0）

**现象**: Proxy 在重新进入工作流时可能再次执行 Stage 3（创建 Agent），导致 tmux session 数量暴增。

**根因**:
- proxy-prompt.template.md 没有检查 Agent 是否已存在
- 没有持久化的启动标记
- Proxy 没有状态感知——每次进入对话都从头执行

**修复**:
- 在 Stage 3 前增加 tmux session 存在性检查
- 增加 `.planning/agent-state/launched.json` 启动标记文件
- 如果 Agent 已存在，跳过创建阶段

---

## Bug 3: hub-call.sh 缺少超时设置（P1）

**现象**: Agent 与 Hub 通信时，curl 没有超时限制。网络不稳定时 curl 可能永远挂起。

**根因**: curl 调用缺少 `--connect-timeout` 和 `--max-time` 参数。

**修复**: 
- 初始化请求和工具调用都加上 `--connect-timeout 5` 和 `--max-time 30`

---

## Bug 4: CLI Agent 提前退出轮询循环（P1）

**现象**: Agent 在收到"没有新消息"或"没有可用任务"后，认为自己"完成了任务"并主动退出。

**根因**:
- prompt 模板中"永不退出"的指令不够具体
- Agent 将"等待消息"理解为一个已完成的操作而非持续的循环
- 没有明确告诉 Agent "你的下一个动作永远是调用 Shell 工具"

**修复**:
- 强化所有 CLI agent prompt 的生命周期规则部分
- 明确说明 sleep + 继续 poll 的具体步骤
- 强调"你的下一个动作永远是调用 Shell 工具"

---

## Bug 5: cli-config.json 竞争条件（P2 — 已知）

**现象**: 多个 Agent 同时启动时出现 `ENOENT: no such file or directory, rename cli-config.json.tmp -> cli-config.json`

**根因**: Cursor CLI 进程启动时写入 `~/.cursor/cli-config.json`，多个进程同时写导致 rename 竞争。

**证据**:
```
Error: ENOENT: no such file or directory, rename '/Users/mac/.cursor/cli-config.json.tmp' -> '/Users/mac/.cursor/cli-config.json'
```

**状态**: Cursor CLI 内部问题，无法在 gsd-2 层面修复。可通过 launch-cluster.sh 的批量启动延迟缓解（已有 `--batch` 参数）。

---

## Bug 6: Hub CLK 反复注册（P2 — 观察到）

**现象**: Hub 日志显示 CLK agent 反复调用 `hub_register`。

**证据**:
```json
{"agent_id":"clk","msg":"hub_register"}
{"agent_id":"clk","msg":"hub_register"}
{"agent_id":"clk","msg":"hub_register"}
```

**根因**: CLK agent 在 while true 重启循环中，每次重启都重新注册。Hub 的 upsert 机制使得重复注册不会出错，但浪费了日志和 API 调用。

**状态**: 指数退避修复后，重启频率会降低，但根本原因是 Agent 没有维持内部轮询循环。已通过 prompt 强化改善。

---

## Bug 7: 文档声明的工具未实现（P2 — 文档-代码差异）

**现象**: CHANGELOG v0.5.0 和 ARCHITECTURE.md 引用了 `hub_report_degradation` 和 `hub_system_resources` 两个 Hub 工具，但 `src/transport/http.ts` 中并未实际实现。

**证据**:
- CHANGELOG.md L52-53: 声明 `hub_report_degradation` 用于上报质量劣化
- CHANGELOG.md L73: 声明 `transport/http.ts` 新增这两个工具
- ARCHITECTURE.md L335-350: 描述了基于 `hub_report_degradation` 的质量监控流程
- `http.ts` 实际工具列表（grep 结果）：无 `report_degradation` 或 `system_resources`

**影响**: Supervisor 无法按 ARCHITECTURE.md 描述的流程上报质量劣化。质量监控功能实际不可用。

**建议修复**: 在 `http.ts` 中实现这两个工具，或更新文档说明该功能为 planned/未实现。
