# PolarClaw Prompt 工程 Binding

## 核心主张

1. **一体两面**：飞书入口和 IDE 入口共享同一个 Agent 核心（ReAct 循环 + 工具注册 + 记忆系统），仅通过 system prompt 差异化实现角色分离。这是最经济的架构——零代码分叉，零同步成本。

2. **Prompt 即产品**：提示词模板是用户体验的直接载体。各入口有差异化的交互风格（飞书精炼、IDE 技术向），但能力完全等效。修改提示词 = 修改产品行为，无需改代码。

3. **Append 而非 Replace**：入口特化 Prompt 通过 PolarPrivate 的 `append_system_prompt` 机制注入，叠加在 persona 和 SOUL.md 之上，不替换它们。层次：SOUL.md（生态地图）→ persona（人格风格）→ entry prompt（交互风格，不限能力）。

## 计费优化策略

PolarPrivate LLM Proxy 按调用计费（非按 token），因此每次调用应尽量塞入最多上下文。具体做法：

- system prompt 合并（SOUL + persona + entry + 记忆上下文）一次性注入
- 长对话通过上下文压缩器（ContextCompressor）裁剪，而非拆成多次短调用
- ComputerUse VLM 调用（本地 Ollama）零远程成本

## 已验证的技术决策

| 决策 | 原因 | 验证状态 |
|------|------|----------|
| Stagehand v3 + Playwright 做 ComputerUse | AI-native 浏览器操作，比 Puppeteer 脚本更适应页面变化 | Smoke test 通过 |
| VLM 走 Ollama (qwen3-vl:8b) | MLX 原生推理，零网络延迟，M 系列芯片效率最优 | 替换 llama-server gemma-3 |
| compatFetch 拦截器 | Stagehand 默认走 Responses API，PolarPrivate 只有 Chat Completions | 生产验证 |
| 入口检测基于 channel 元数据 | 零解析成本，channel 信息在消息路由时已确定 | — |
