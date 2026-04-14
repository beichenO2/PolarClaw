# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-07)

**Core value:** 多个独立 AI Agent 能像一个团队一样自治协作——无需人类持续驱动，Agent 自己领任务、干活、广播进度、协调冲突。
**Current focus:** v1 Hub 六阶段 Agent-C 集成验证与文档已闭环；后续为生产加固（如 `SafetyLimiter` 全工具挂钩）与 CLI 封装

## Current Position

Phase: 6 of 6（集成验证完成）
Plan: — of — in current phase
Status: Phase 6 交付：`hub_set_limits`、`hub_get_audit_log`、`hub_get_health`、`hub_get_progress`；E2E 见 `tests/e2e/safety-obs.test.ts`，文档见 `docs/phase-6-operations.md`。Phase 2–5 文档见 `docs/phase-*`。
Last activity: 2026-04-08 — Agent-C：Phase 2–6 `npm test` 全绿，`done-agent-c-all.signal` 已写入

Progress: ██████████ 100%（6/6 phase Agent-C 验证与文档完成）

## Initialization Summary

### 项目起源

用户希望基于 get-shit-done（GSD-1）的理念，打造一个全新的自治多 Agent 协作框架 gsd-2。核心动机：

1. GSD-1 是层级编排模型（PhaseRunner → subagent），需要单一进程持续运行
2. GSD-1 的 Agent 间无直接通信，只通过文件系统间接协调
3. 用户需要不断说"继续"来驱动工作流
4. 用户希望"去睡觉，Agent 自己继续干活"

### 核心架构决策

| 决策 | 理由 |
|------|------|
| MCP Server 作为通信中枢 | Cursor 原生支持 MCP，Agent 通过工具调用直接通信 |
| Streamable HTTP（非 stdio）| stdio 是每 client 一个进程，无法共享内存；HTTP 支持多会话 |
| 对等网络而非层级编排 | 允许任意数量 Agent 动态加入/退出 |
| 一次性配置模型 | 消除反复询问原则问题 |
| 人类只在需求定义阶段介入 | 用户明确要求其余全部自动化 |
| TypeScript/Node.js | 与 GSD-1 保持技术栈一致 |
| Cursor 优先，设计可扩展 | v1 只保证 Cursor |
| 只拿 GSD-1 的理念，不拿代码 | 架构差异太大 |

### 用户配置偏好

- **工作模式**: YOLO（自动审批，直接执行）
- **粒度**: Standard（5-8 phases）
- **执行**: 并行
- **Git**: 规划文档纳入版本控制
- **研究/计划检查/验证**: 全部启用
- **AI 模型**: 继承当前会话模型
- **人类干预**: 仅在需求定义阶段

### 研究关键发现

- **Stack**: MCP SDK 1.29.0 + Streamable HTTP + Zod 4.x + better-sqlite3 + pino + Node 22 LTS
- **"Continue" 问题**: Cursor Agent 不是后台守护进程，需要通过 MCP 工具调用的批量处理 + 检查点 + Continue 机制来维持循环
- **并发安全**: 路径租约（path leases）+ 原子写入（temp+rename）+ 乐观并发控制
- **关键风险**: Cursor 工具调用数量限制（~25-40次/交互）、SSE 行为需验证、文件 vs SQLite 持久化策略需实测决定

### 项目指标

- **v1 需求**: 38 个，分 7 类（HUB/TASK/STATE/AUTO/CONFIG/OBS/AGENT）
- **路线图**: 6 个 phase，按依赖顺序执行
- **Git 提交**: 5 次（初始化→配置→研究→需求→路线图）

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |

**Recent Trend:** —

## Accumulated Context

### Decisions

见上方「核心架构决策」。详细决策也记录在 `PROJECT.md` Key Decisions 表中。

路线图依赖顺序：transport + durability → broadcast + planning state → tasks + leases → path leases + config → agent loop + checkpoints → safety + observability

### Pending Todos

- [ ] 在实际项目上测试 `$gsd2-go` 工作流（端到端验证）
- [ ] 完善 skill 中的错误处理和边界情况
- [x] 实现自建 MCP Hub — **Phase 1（HUB-01/02/03/06）已在 repo 内可用**（`npm run start`，默认 `http://127.0.0.1:8765/mcp`）
- [ ] 继续 Phase 2–6 与将 OpenClaw 依赖替换为自建 Hub（全量能力）

### Blockers/Concerns

- **待验证**: Cursor 对 Streamable HTTP + GET SSE 的支持情况
- **待验证**: 实际工具调用/Continue 次数限制
- **已决（Phase 1）**: Hub 热路径使用 **SQLite + Drizzle**（见 `src/persistence/`）；`.planning/` 文件权威留待 Phase 2

## Session Continuity

Last session: 2026-04-08
Stopped at: Phase 1 MCP Hub（Streamable HTTP + SQLite 持久化 + 基础工具）实现完毕，`npm test` / `npm run build` 通过
Next step: Phase 2 — 广播（SSE + 轮询回退）、`.planning/` 版本化状态与幂等工具
Resume file: None

## Phase 1 实施摘要（2026-04-08）

| 项目 | 说明 |
|------|------|
| 入口 | `src/server.ts`，`GSD_HUB_PORT` / `GSD_HUB_DB` / `GSD_HUB_HOST` 环境变量 |
| 传输 | `src/transport/http.ts` — POST/GET/DELETE `/mcp`，`@modelcontextprotocol/sdk` Streamable HTTP |
| 持久化 | `src/persistence/db.ts` + `store.ts` — `sessions`、`messages` 表；WAL + `synchronous=FULL` |
| 会话 | `SessionRegistry` + `upsertSession`：同一 `agent_id` 重连时更新 `mcp_session_id`，未消费消息仍按 `agent_id` 恢复 |
| 工具 | `hub_register`、`hub_status`（含 pending 消息）、`hub_ping`（心跳 + ack 消费） |
| 测试 | `tests/hub.integration.test.ts` — 双会话并行、进程重启后 DB 复开恢复消息 |

## gsd2 Skill 体系

### 已创建的 Skills（v1）

| Skill | 描述 | 状态 |
|-------|------|------|
| `$gsd2-new-project` | 从想法到完整计划书（深度对话式） | ✅ 已创建 |
| `$gsd2-go` | 一键启动多 Agent 自动执行 | ✅ 已创建 |
| `$gsd2-progress` | 交互式进度报告 | ✅ 已创建 |
| `$gsd2-map-codebase` | 代码库扫描映射 | ✅ 已创建 |
| `$gsd2-discuss-phase` | Phase 前深度讨论 | ✅ 已创建 |
| `$gsd2-plan-phase` | 创建 Phase 执行计划 | ✅ 已创建 |
| `$gsd2-execute-phase` | 多 Agent 执行 Phase | ✅ 已创建 |
| `$gsd2-do` | 自然语言路由 | ✅ 已创建 |
| `$gsd2-next` | 自动推进下一步 | ✅ 已创建 |
| `$gsd2-fast` | 快速执行简单任务 | ✅ 已创建 |
| `$gsd2-help` | 帮助命令 | ✅ 已创建 |
| `$gsd2-wakeup` | 唤醒守护进程 | ✅ 已创建 |

### 架构决策（本次对话确定）

| 决策 | 选择 | 理由 |
|------|------|------|
| MCP 通信 | 当前用 OpenClaw，最终自建 Hub | 先跑通工作流，最后替换通信层 |
| Skill 命名 | `gsd2-*` 前缀 | 避免与 gsd-1 冲突，全局安装 |
| 角色分工 | 一号主控(文档/架构) + 二号主控(执行) + 工作Agent | 分离关注点 |
| 唤醒机制 | 定时唤醒 + 消息缓冲 | 防止 LLM 卡住，支持任务注入 |
| 用户确认 | 1分钟规则（无响应按默认走） | 最小化用户操作 |
| 核验策略 | 跑测试 + 网搜最佳实践 + Agent review | 效果第一，不计成本 |

### MCP 频道分配

| 频道 | 角色 |
|------|------|
| openclaw-4 | 一号主控（与用户对接） |
| openclaw-5 | 二号主控（执行控制器） |
| openclaw-6~13 | 工作 Agent 槽位 |
| openclaw-15 | 唤醒程序 |
| openclaw-16~18 | 备用 |

## Artifacts Map

```
gsd-2/
├── .planning/
│   ├── PROJECT.md          — 项目上下文、核心价值、需求概览、约束、关键决策
│   ├── config.json         — 工作流配置（YOLO/standard/parallel/inherit）
│   ├── REQUIREMENTS.md     — 38 个 v1 需求，7 类，含追溯矩阵
│   ├── ROADMAP.md          — 6 phase 路线图，含成功标准
│   ├── STATE.md            — 本文件，项目状态和会话连续性
│   └── research/
│       ├── STACK.md        — 技术栈研究（MCP SDK、transport、持久化、日志）
│       ├── FEATURES.md     — 功能研究（table stakes vs differentiators）
│       ├── ARCHITECTURE.md — 架构研究（Hub 结构、Agent 循环、冲突模型）
│       ├── PITFALLS.md     — 陷阱研究（Cursor 限制、自治风险、并发危害）
│       └── SUMMARY.md      — 研究综合（推荐方案、构建顺序、开放问题）
├── src/                    — MCP Hub 实现（server、transport、persistence、session）
├── tests/                  — Vitest 集成测试
└── .git/
```
