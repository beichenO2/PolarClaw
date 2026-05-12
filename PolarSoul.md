# PolarClaw 灵魂

> 多通道 AI Agent 融合平台。Agent 修改本项目前，必须阅读并遵守以下核心特质。

---

## 核心特质

| 特质 | 与社区同类项目的差异 |
|------|----------------------|
| **端口-适配器架构** | 核心逻辑不依赖外部，通过适配器对接飞书/CLI/API 等通道 |
| **多入口架构** | EntryType 扩展为 feishu/cli/web/ide/api 五种入口，支持 Hub Web 集成和 IDE 插件 |
| **Meta-Skills 三层** | SOUL（生态地图）→ Meta-Skills（任务类型思维框架）→ Tool-Skills（按需加载工具） |
| **多用户人格差异化** | 按 userId 加载不同 persona，控制交互风格和技能可见性 |
| **双入口提示词分层** | 飞书入口（产品经理角色）和 IDE 入口（开发者角色）差异化 system prompt |
| **自学习系统** | 工具使用追踪 → 模式检测 → 自动技能生成 → 晋升验证；支持 PolarPilot arrow_logs 接入 |

---

## 外部合作

### 依赖

- [PolarPrivate](../PolarPrivate/PolarSoul.md)：LLM 调用代理
- [SOTAgent](../SOTAgent/PolarSoul.md)：端口分配
- [Clock](../Clock/PolarSoul.md)：日程驱动关怀

### 被依赖

- [KnowLever](../KnowLever/PolarSoul.md)：知识检索技能
- [digist](../digist/PolarSoul.md)：信息摘要技能
- [AutoOffice](../AutoOffice/PolarSoul.md)：报告生成技能
- [PolarPilot](../PolarPilot/PolarSoul.md)：SDK 适配器
- [PolarCopilot](../PolarCopilot/PolarSoul.md)：Hub Web 集成

### 接口契约

- `/api/chat`：LLM 代理 API
- `/api/sdk/*`：SDK HTTP 端点
- `/api/claw/learning/arrow-logs`：PolarPilot arrow_logs 接收端点
- `polarclaw-project-sdk`：外部项目 SDK 客户端
- Hub Web SSE：与 PolarCopilot Hub 的实时通信

---

## 设计决策

### 为什么用端口-适配器架构？

**问题**：传统 Agent 紧耦合到特定通道（如飞书），难以扩展。

**决策**：核心逻辑在 `core/` 目录，适配器在 `adapters/` 目录，新增通道只需写适配器。

**不可妥协**：核心逻辑不得直接依赖任何通道 SDK。

### 为什么 Meta-Skills 三层？

**问题**：传统 Skill 是扁平的工具列表，缺乏任务级别的思维框架。

**决策**：
- SOUL：生态地图，告诉 Agent 整个生态有什么
- Meta-Skills：任务类型思维框架（如"实验报告"元技能）
- Tool-Skills：按需加载的具体工具

**不可妥协**：元技能不注册工具，只提供思维框架。

### 为什么多入口架构？

**问题**：传统 Agent 只支持单一入口，难以适应不同交互场景。

**决策**：
- EntryType 扩展为 feishu/cli/web/ide/api 五种入口
- 每种入口有独立的提示词模板和交互模式
- Hub Web 集成支持阻塞式 Prompt 交互

**不可妥协**：核心逻辑不依赖任何特定入口。

---

## 详情入口

- [SSoT](polaris.json)
- [使用指南](README.md)
- [生态地图](skills/SOUL.md)
