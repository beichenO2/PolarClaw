# gsd-2

## What This Is

gsd-2 是一个基于 MCP（Model Context Protocol）的自治多 Agent 协作框架。它让多个 Cursor Agent（各自独立的对话窗口）通过 MCP Server 进行广播式通信和任务协调，实现无人值守的软件工程自动化。用户只需在初始化时定义需求和配置偏好，系统即可自主完成从规划到执行的全流程。

## Core Value

多个独立 AI Agent 能像一个团队一样自治协作——无需人类持续驱动，Agent 自己领任务、干活、广播进度、协调冲突。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] MCP Server 作为 Agent 间通信中枢，支持任务广播、状态同步、事件通知
- [ ] Agent 运行"做任务→监听"循环，通过 MCP 工具获取新任务
- [ ] 多个 Cursor 对话窗口中的 Agent 可对等协作，不依赖层级编排
- [ ] 项目初始化时一次性收集所有配置偏好（干预点、自动化级别等），后续不再重复询问原则问题
- [ ] 人类干预点可配置：用户可选择在哪些流程环节介入，其余全部自动化
- [ ] 自带任务分解和分配机制，能将大任务拆分为可并行的子任务
- [ ] Agent 间通过广播机制共享进度、发现冲突、请求协助
- [ ] 支持无人值守运行——用户离开后 Agent 继续工作
- [ ] 从 GSD-1 继承流程设计理念（phase-based workflow、状态管理、验证机制），但架构全部重写
- [ ] TypeScript/Node.js 技术栈
- [ ] Cursor 优先，设计上可扩展到其他 IDE

### Out of Scope

- 直接修改或 fork GSD-1 代码 — 本项目是独立新建项目
- PolarPrivate 项目 — 与本项目无关
- 多 IDE 同时支持 — v1 只保证 Cursor，但架构预留扩展点
- 自己训练 AI 模型 — 使用现有 LLM API
- 图形化 UI 管理界面 — v1 通过命令行和 MCP 交互

## Context

**动机：** GSD-1 是一个优秀的 AI 编排框架，但它的核心局限在于：
1. 层级编排模型（PhaseRunner → subagent）需要单一进程持续运行
2. Agent 间无直接通信通道，只通过文件系统间接协调
3. 每个命令是一个用户 turn，需要人类不断发起下一步
4. 虽然有 `auto_advance` 和 YOLO 模式，但仍依赖单一会话上下文窗口

**gsd-2 的核心架构变革：**
- 从「层级编排」变为「对等网络」——每个 Agent 是独立的一等公民
- 从「用户驱动」变为「自治驱动」——Agent 自己知道下一步该做什么
- 从「文件系统间接协调」变为「MCP 直接通信」——实时广播和事件通知
- 从「重复询问」变为「一次配置」——所有偏好在初始化时确定

**技术环境：**
- Cursor IDE 作为 Agent 运行环境
- MCP 协议作为 Agent 间通信标准
- TypeScript/Node.js 技术栈
- 基于 GSD-1 的流程设计理念（discuss → research → plan → execute → verify）

**与 GSD-1 的关系：**
- 理念继承：phase-based workflow、状态管理、验证机制、模板系统
- 代码独立：不 import/fork GSD-1 代码，架构差异太大
- 文件共存：gsd-2 和 get-shit-done 在同一工作区的不同目录

## Constraints

- **IDE 环境**: Cursor 的 Agent 模型决定了每个 Agent 是一个独立对话，通过 MCP 工具扩展能力
- **MCP 协议**: Agent 间通信必须走 MCP 标准，确保与 Cursor 和未来 IDE 兼容
- **无持久进程**: Cursor Agent 本身不是后台服务，需要设计巧妙的循环机制让 Agent 保持活跃
- **上下文窗口**: 每个 Agent 有上下文限制，需要设计状态持久化和上下文恢复机制
- **并发安全**: 多 Agent 并行写文件需要冲突检测和解决机制

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MCP Server 作为通信中枢 | Cursor 原生支持 MCP，Agent 可通过工具调用直接与 Server 通信，无需额外进程间通信机制 | — Pending |
| 对等网络而非层级编排 | 允许任意数量 Agent 动态加入/退出，不依赖单一编排进程的存活 | — Pending |
| 一次性配置模型 | 消除 Agent 反复询问原则问题的烦恼，所有偏好持久化到配置文件 | — Pending |
| 人类只在需求定义阶段介入 | 用户明确表示不想在规划、执行、验证阶段被打断，想要"火力全开"的自动化 | — Pending |
| 从 GSD-1 拿理念不拿代码 | 架构差异太大（层级 vs 对等），强行复用代码反而增加复杂度 | — Pending |
| TypeScript/Node.js | 与 GSD-1 保持技术栈一致，便于理解和参考 GSD-1 的设计思路 | — Pending |
| 先用 OpenClaw 再自建 Hub | 先跑通多 Agent 工作流，验证 skill 设计，最后才实现自有 Hub | ✅ Decided |
| Skill 命名 gsd2-* 前缀 | 全局安装，避免与 gsd-1 冲突 | ✅ Decided |
| 1分钟规则 | 任何需要用户确认的地方，1分钟无响应按默认方案执行 | ✅ Decided |
| 唤醒程序 + 消息注入 | 独立进程定时唤醒主控，防止 LLM 卡住；支持用户通过缓冲区注入消息 | ✅ Decided |
| 核验不计成本 | 跑测试 + 上网搜最佳实践 + Agent 交叉 review，效果第一 | ✅ Decided |
| 尽可能多上网搜索 | Agent 应主动搜索最新信息，不依赖训练数据中的过期知识 | ✅ Decided |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

## Design Principles (gsd-2 核心设计原则)

1. **用户操作最小化** — 用户说一句话，然后去做别的事
2. **确认最少化** — 1分钟无响应按推荐方案执行，不等人
3. **速度优先** — 多个 Agent 并行，能并行的绝不串行
4. **搜索优先** — 遇到不确定的事情先上网搜，不靠经验
5. **核验最大化** — 跑测试 + 搜最佳实践 + 交叉 review，不计成本
6. **一个对话走到底** — 主控在一个持续的 check_messages 循环中完成所有工作

---
*Last updated: 2026-04-07 after skill framework v1*
