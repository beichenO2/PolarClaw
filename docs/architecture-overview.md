# PolarClaw 架构概览

## 一、入口通道

| 入口 | 通道名 | 触发方式 | 角色定位 |
|------|--------|----------|----------|
| **飞书 Bot** | `feishu:admin` / `feishu:girlfriend` | 飞书 WebSocket 长连接 | 全能助手（精炼交付） |
| **CLI** | `cli` | TTY 命令行 / `FORCE_CLI=1` | Web 模式（开发调试用） |
| **Web Dashboard** | `web` | HTTP `:3910/mc/chat` SPA | 产品经理助手（只做已有工作流 + Demo） |
| **Hub Web** | `hub-web` | `MODE=hub-web` 环境变量，SSE 长连接 Hub | 被 PolarCopilot Hub 调度 |
| **HTTP API** | `api` | 直接调用 `/api/chat` | 同 Web |

### 启动方式

- `Start/start.sh` → 优先通过 PolarProcess API 注册启动，降级为 `nohup node dist/main.js`
- `Start/stop.sh` / `Start/restart.sh` 配套管理
- npm script: `npm run dev` (tsx watch) / `npm start` (node dist/main.js)

---

## 二、提供的服务

### 核心 Agent 能力

- **ReAct 工具调用循环**：多轮对话 + tool_calls + 观察
- **上下文压缩**：3 阶段渐进式（工具输出截断 → 滑窗保留 head/tail → LLM 摘要），避免超窗口
- **TaskContract**：自动拆解复杂任务为多步，步间注入 checkpoint
- **项目锁**：防止多 Agent 冲突编辑同一项目

### Web Server API（`:3910`）

| 路由 | 功能 |
|------|------|
| `/api/status` | 服务状态 |
| `/api/chat` / `/api/chat/stream` | Agent 对话接口 |
| `/api/reviews/*` | PDF/PPT 文档审阅 |
| `/api/workspace-memory/*` | 工作区记忆 |
| `/api/session-memory/*` | 会话记忆 |
| `/api/yolo/*` | YOLO 自主执行 |
| `/api/sdk/*` | PolarClaw SDK 路由 |
| SPA 前端 | `web/dist` |

### 内置工具

| 工具名 | 功能 |
|--------|------|
| `file_organize` / `file_inbox_list` | 文件分类归档 |
| `memory_save` / `memory_search` | 长期记忆（SQLite + PolarMemory） |
| `yolo_start` | YOLO 自主执行 |
| `care_add_rule` | 主动关怀定时规则 |
| `skill_search` / `skill_activate` / `skill_deactivate` | 技能元管理 |
| `learning_*` 系列 | 自学习（反馈/模式检测/技能生成/组合） |
| AlwaysOn 工具 | DiscoveryPlan / Report |

### 外部集成

| 服务 | 作用 |
|------|------|
| PolarPrivate | 隐私网关 + Secret + LLM Proxy |
| Clock | 番茄钟/日程 SSE 桥接 |
| KnowLever | RAG 知识库 |
| AutoOffice | 文档生成 |
| PolarMemory | 长期跨会话记忆 |
| PolarPort | 端口发现 |

---

## 三、Prompt 加载逻辑

### 组装流程

System Prompt 由 5 层组装，**每轮 LLM 调用时动态拼接**：

```
systemContent = [
  basePrompt,          // 层1: Soul + 技能目录 + Persona
  entryPrompt,         // 层2: 入口角色差异化
  rulesAppend,         // 层3: 运行时规则注入（关键词触发）
  skillRulesAppend,    // 层4: 已激活技能专属规则
  contractInjection,   // 层5: TaskContract 当前步骤
  sessionMemoryPrefix, // 附: 会话记忆上下文
].join('\n\n')
```

### 层1 — basePrompt（Soul + 技能目录 + Persona）

**加载顺序**：
1. 优先读 `skills/SOUL.md`（生态地图）
2. 若存在则与 `worker.md`（身份定义）合并：`worker.md + SOUL.md`
3. 追加 `skillCatalog` — 元技能索引（`metaIndex.toPromptCatalog()`）的纯文本目录
4. 追加 Persona 正文

**Persona 匹配**：
- `PolarUser registry` 按 `userId` → `persona` 映射
- 文件路径：`personas/{persona_name}.md`，fallback `personas/default.md`
- 支持 YAML frontmatter：`allowed_skills` 控制用户可见技能子集
- 支持模板变量：`{{llm_model}}`、`{{capabilities}}`

**技能目录过滤**：
- `skillCatalog` 按 Persona 的 `allowedSkills` 白名单过滤
- 用户看不到白名单外的技能条目

### 层2 — entryPrompt（入口角色差异化）

**匹配逻辑**（`src/core/entry-prompt.ts`）：

```
detectEntryPoint({channel}) → EntryType
```

| 通道关键词 | 入口类型 | Prompt 文件 |
|-----------|---------|-------------|
| feishu/lark | feishu | `prompts/entry-feishu.md` |
| web/dashboard | web | `prompts/entry-web.md` |
| cli/tty | cli | 使用 simulation mode（默认 web） |
| 其他 | api | `prompts/entry-web.md` |

- CLI 有 simulation mode（`--mode web`），切换后加载对应模板
- 文件内容有内存缓存（`promptCache` Map），进程生命周期内只读一次磁盘

### 层3 — rulesAppend（运行时动态规则）

- `src/rules/runtime-inject.ts` 调用 `Agent_core/rules/engine/runtime-inject.mjs` 的 `buildClawAppend(userText)`
- 根据**用户最新消息内容**匹配触发关键词，注入对应规则片段
- 类似 Cursor Rules 的 `auto_attached` 机制，但基于正则匹配

### 层4 — skillRulesAppend（技能专属规则）

- `skill_activate` 时调用 `buildSkillRulesAppend(skillId)` 获取该技能的专属规则
- 通过 `setActiveSkillRules(name, rules)` 存入全局 Map
- 每轮 LLM 调用时 `getActiveSkillRulesPrompt()` 收集所有已激活技能规则拼接

### 层5 — contractInjection（任务合约）

- 用户首条消息时 LLM 分析提取约束和步骤（`extractContractFromMessage`）
- 与生态约束（`loadEcoConstraints`）合并生成 TaskContract
- 每轮注入当前步骤要求和约束
- 步骤完成时注入 checkpoint 消息，驱动多步执行
- 简单任务（单步）跳过 contract 注入

### 附：记忆注入

**两个注入点**：

1. **memoryContext**（注入到 user message 前面）：
   - 用户画像 profiles（最多 15 条）
   - FTS5 搜索相关记忆（按 userId 隔离，最多 5 条）

2. **sessionMemoryPrefix**（注入到 system prompt 末尾）：
   - SessionMemory 从 PolarMemory 拉取长期 blocks（按语义相关性 top_k）
   - `buildMemoryInjection(convId)` 组装工作记忆 + 长期记忆 + core facts

---

## 四、LLM 路由

模型选择不在 Prompt 层，由独立路由器决策：

1. **classifyAndRoute()**：按消息长度/内容正则 → 4-bit QCSA capability code
   - `light` (0011): 短消息 / Always-On
   - `standard` (1001/0001): 编程 / 工具循环 / 默认
   - `heavy` (1110): 研究 / 长上下文

2. **不直接指定模型名**，capability code 发给 PolarPrivate LLM Proxy，由 Proxy 路由到实际模型

3. **3 层弹性**：
   - Tier 1: PolarPrivate 云端（指数退避重试 1s/3s/8s）
   - Tier 3: 本地 Ollama（通过 PolarPrivate L-codes，无 tool_calls）
