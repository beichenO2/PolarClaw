# MyClaw — AI Agent 融合平台

端口-适配器（六边形）架构，TypeScript + Node.js。

## 架构

```
用户 ← 飞书/Telegram/Web →
  Channel Adapter (ports/channel.ts)
    → Privacy Gateway (ports/privacy.ts)  ← PolarPrivate
      → Agent Core (core/agent.ts)
        → LLM Router (ports/llm.ts)      ← 阿里云百炼
        → Tool Executor (ports/tools.ts)
        → Memory Store (ports/memory.ts)  ← SQLite + FTS5
        → Conversation History            ← 多轮对话
        → Skill Loader (ports/skills.ts)  ← Clock 等外部集成
```

## 目录结构

```
src/
├── ports/          ← 接口定义（不依赖任何实现）
│   ├── channel.ts
│   ├── privacy.ts
│   ├── memory.ts
│   ├── llm.ts
│   ├── tools.ts
│   └── skills.ts
├── adapters/       ← 接口实现（可替换）
│   ├── channel/    ← 飞书、Telegram 适配器
│   ├── memory/     ← SQLite 存储 + 对话历史
│   ├── llm/        ← OpenAI-compatible 路由器
│   ├── privacy/    ← PII 检测 + PolarPrivate 集成
│   └── tools/      ← 工具执行器
├── core/           ← Agent 核心（只依赖 ports）
│   └── agent.ts
├── config.ts
└── main.ts
skills/
└── clock-integration/  ← PolarClock 集成技能
```

## 快速开始

```bash
cp .env.example .env
# 编辑 .env 填入 API Key
npm install
npm run dev
```

## 核心特性

- **多轮对话**：对话历史持久化，支持上下文窗口管理
- **隐私保护**：PolarPrivate 集成，自动 PII 脱敏 + Secret 拦截
- **意图路由**：根据消息内容自动选择最合适的模型
- **可替换架构**：端口-适配器模式，任何模块可独立替换
- **Clock 集成**：番茄钟状态感知，根据用户工作状态调整行为
