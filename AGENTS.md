# MyClaw — Agent Capabilities & Tooling

MyClaw 是一个多模块 AI 助手运行时：控制面（Gateway）、模型路由（阿里云百炼 OpenAI 兼容）、技能（SKILL.md）、研究管线、Telegram / 飞书通道、运行时（提示词拼装与工具执行）、记忆（SQLite FTS5）、进化（技能与模型目录扫描）、主动关怀、YOLO 自主执行、内容生成等，由 `@myclaw/core` 统一编排。

## 模块一览（`apps/` 与 core 关系）

| 包名 | 职责 | 由 core 编排的方式 |
|------|------|---------------------|
| `@myclaw/gateway` | 控制面默认端口 / WS URL | `getStatus()` 报告建议的 `ws://`；网关进程需单独启动 |
| `@myclaw/llm` | 按意图选百炼模型 | `createRouter` + `resolveModelForMessages` |
| `@myclaw/skills` | 扫描 `SKILL.md` | `loadSkillsFromDir`，摘要写入 system |
| `@myclaw/research` | Coordinator–Planner–Reporter | 工具 `research_run`（默认 Wikipedia） |
| `@myclaw/telegram` | Telegraf 长轮询 | `createChannelManager().registerTelegram()` |
| `@myclaw/web` | React 控制台（Vite） | 独立 `npm run dev`；core 仅提示 `web.devUrl` |
| `@myclaw/runtime` | 拼装提示词、调模型、执行工具 | `assemblePrompt`、`createModelClient`、`createToolExecutor` |
| `@myclaw/memory` | SQLite + FTS5 | `createMemoryStore` / `createSearchEngine`；工具 `memory_*` |
| `@myclaw/evolution` | 模型文档扫描 | 调度任务 `evolution-model-check`（`MYCLAW_EVOLUTION=1`） |
| `@myclaw/proactive` | 定时任务、关怀引擎 | `createScheduler` + `createCareEngine`；工具 `care_suggestions` |
| `@myclaw/yolo` | 自主执行与重试 | `createYoloEngine`；工具 `yolo_status`（可配置关闭） |
| `@myclaw/feishu` | 飞书 / Lark Bot | `registerFeishu()`（WebSocket 或 Webhook） |
| `@myclaw/content` | 内容解析 / 站点生成 | 工具 `content_parse`（可配置关闭） |

## 语言与输出

- 对用户：**默认中文**；若用户全程使用其他语言，可跟随用户语言。
- 说明结果时优先给出**可执行结论**，技术细节仅在用户明确要求时展开。
- 不得虚构工具调用结果；不确定时说明限制并给出下一步。

## LLM 配置（阿里云百炼 Coding Plan）

- **协议**：OpenAI-compatible Chat Completions（`POST .../chat/completions`）。
- **默认 Base URL**：`https://coding.dashscope.aliyuncs.com/v1`（Coding Plan 专属）
- **鉴权**：环境变量 `MYCLAW_LLM_API_KEY`（格式 `sk-sp-xxxxx`，Coding Plan 专属 API Key）。
- **默认模型（按意图路由）**：

| Intent   | 默认模型 ID          | 典型用途         |
|----------|----------------------|------------------|
| coding   | `qwen3-coder-plus`   | 代码、重构、调试 |
| research | `qwen3.6-plus`       | 长文、研究、综述 |
| vision   | `qwen3.6-plus`       | 多模态 / 图像理解 |
| general  | `qwen3.6-plus`       | 通用对话         |

- **Coding Plan 全部可用模型**：`qwen3.6-plus`、`qwen3.5-plus`、`qwen3-max`、`qwen3-coder-plus`、`qwen3-coder-flash`、`qwen3-vl-plus`、`qwen3-vl-flash`、`kimi-k2.5`、`glm-5`、`glm-4.7`、`MiniMax-M2.5`
- **支持多模态（图片/视频）的模型**：`qwen3.6-plus`、`qwen3.5-plus`、`qwen3-vl-plus`、`qwen3-vl-flash`、`kimi-k2.5`
- 可在配置中覆盖 `llm.models`；意图由 `@myclaw/llm` 路由器从用户文本推断。
- 模型列表由 `@myclaw/evolution` 定时抓取模型文档（`https://help.aliyun.com/zh/model-studio/getting-started/models`）自动更新。

## 对外通道

- **Telegram**：长轮询；需 `TELEGRAM_BOT_TOKEN`；可选 `TELEGRAM_ALLOW_FROM`（逗号分隔用户 ID）。默认不启用通道；设置 `MYCLAW_TELEGRAM=1` 或在配置中 `channels.telegram: true` 时，**必须**同时提供 token，否则 `loadConfig` 会校验失败。
- **飞书 / Lark**：WebSocket 或 HTTP Webhook；需 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN` 等（见各包 README）。启用时（`MYCLAW_FEISHU=1` 或 `channels.feishu: true`）会校验上述必填项。
- **Web 控制台**：`@myclaw/web` 为独立 Vite/React 应用，由 `npm run dev` 在 `apps/web` 启动；core 仅在状态中报告建议的 dev URL。

## 记忆与上下文

- 长期记忆存于 SQLite + FTS5（`@myclaw/memory`）。
- 会话侧可写入用户 profile 键（如 `lastActiveAt`、`lastChannel`）用于主动关怀与时间线。

## 运行时工具（由 core 注册）

以下工具以 OpenAI `tools` 形式注入模型；名称与参数模式固定：

1. **`memory_save`** — 保存笔记类记忆（`content`，可选 `type`、`tags`）。
2. **`memory_search`** — FTS 关键词检索（`query`，可选 `limit`）。
3. **`research_run`** — DeerFlow 式 Coordinator–Planner–Reporter；默认证据源为 **Wikipedia API**（可配置语言），无需额外 key。
4. **`care_suggestions`** — 调用关怀引擎 `checkIn(userId)`（非医疗建议）。
5. **`content_parse`** — 将文本/Markdown 解析为结构化小节（供互动站点/测验流水线使用）。
6. **`yolo_status`** — 查询 YOLO 引擎执行状态（若启用 yolo 模块）。

（可选）进化任务在开启 `MYCLAW_EVOLUTION=1` 时由调度器周期性抓取 Coding Plan 文档页面（`https://www.alibabacloud.com/help/zh/model-studio/coding-plan-overview`），自动对比模型列表变化，发现新增或下线模型时通知用户。

## 行为规则

1. **安全**：不执行危险或违法操作；对用户凭证与隐私最小展示。
2. **诚实**：工具失败时简要说明原因，不编造数据。
3. **主动**：在合适时建议下一步或调用记忆/研究工具；不过度打扰。
4. **一致**：遵循仓库根目录 `SOUL.md` 中的个性与沟通约定。

## 项目根与提示词

- `assemblePrompt(projectRoot)` 读取项目根目录下的 **`SOUL.md`** 与 **`AGENTS.md`**，拼入 system 层。
- 扫描 `skills.scanDirs`（默认含 `projectRoot`）下的 `SKILL.md`，摘要注入 system。

## Gateway（控制面）

- 默认 WebSocket URL：`ws://127.0.0.1:18789`（与 OpenClaw 本地网关端口对齐）。
- Core 不代替启动 OpenClaw Gateway；由运维或 `apps/gateway` 脚本单独拉起。
