# Phase 1 Execution Prompt

你是 gsd-2 项目的执行 Agent。请完整阅读以下文件获取上下文，然后执行 Phase 1。

## 必读文件

请先阅读这些文件了解项目全貌：
- `.planning/PROJECT.md` — 项目上下文
- `.planning/config.json` — 工作流配置
- `.planning/REQUIREMENTS.md` — 需求定义
- `.planning/ROADMAP.md` — 路线图
- `.planning/STATE.md` — 当前状态
- `.planning/research/SUMMARY.md` — 研究综合
- `.planning/research/STACK.md` — 技术栈研究
- `.planning/research/ARCHITECTURE.md` — 架构研究

## Phase 1: MCP Hub & durable sessions

### Goal
实现一个 MCP Server，以 Streamable HTTP 模式运行，多个 Cursor Agent 可作为独立会话连接。消息和 Hub 状态在断线重连和进程重启后仍然存在。

### Requirements
- **HUB-01**: MCP Server 以 Streamable HTTP 模式运行，支持多个 Cursor Agent 同时连接为独立会话
- **HUB-02**: 每个 Agent 连接时获得稳定的 agent_id 和 session_id，用于路由和审计
- **HUB-03**: Hub 持久化消息到磁盘（SQLite 或文件），Agent 断线重连后可恢复未处理消息
- **HUB-06**: Hub 崩溃重启后能恢复状态，不丢失任务和消息（crash-safe）

### Success Criteria
1. Operator 可以在 Streamable HTTP 模式运行 MCP server，并连接多个 Cursor agent 作为独立会话
2. 每个连接的 agent 获得稳定的 `agent_id` 和 `session_id`，可用于后续工具调用和日志
3. agent 断线后，持久化的消息仍然可用，agent 重连后可恢复未处理的工作
4. Hub 进程崩溃重启后，之前存储的任务和消息仍然存在

### 技术栈（来自研究）
- `@modelcontextprotocol/sdk` v1.29.0 — MCP SDK
- `zod` v4.x — 输入验证
- `better-sqlite3` v12.x — 持久化存储
- `drizzle-orm` v0.45.x — ORM
- `pino` v10.x — 日志
- `nanoid` v5.x — ID 生成
- Node.js 22 LTS
- TypeScript

### 实施要求

1. **项目初始化**: 在 gsd-2 项目根目录创建 `package.json`、`tsconfig.json`，安装依赖
2. **目录结构**: 
   ```
   src/
   ├── server.ts          — MCP Server 主入口
   ├── transport/
   │   └── http.ts        — Streamable HTTP transport 适配
   ├── persistence/
   │   ├── db.ts          — SQLite 数据库初始化和 schema
   │   └── store.ts       — 持久化存储层
   ├── session/
   │   └── registry.ts    — 会话注册和管理
   └── types.ts           — 共享类型定义
   ```
3. **MCP Tools（初始工具集）**:
   - `hub_register` — Agent 注册身份
   - `hub_status` — 查询 Hub 状态
   - `hub_ping` — 心跳/健康检查
4. **持久化**: 使用 SQLite + Drizzle，schema 包含 sessions、messages 表
5. **测试**: 编写基本的集成测试验证多会话连接和持久化

### 工作模式
- YOLO 模式：不需要等待审批，直接执行
- 完成后更新 `.planning/STATE.md` 的进度
- 每个重要步骤完成后 git commit
- 不要问问题，按照以上要求直接实施
