# MyClaw — AI Agent 融合平台

端口-适配器（六边形）架构，TypeScript + Node.js。

## 架构

```
用户 ← 飞书/CLI →
  Channel Adapter (ports/channel.ts)
    → Privacy Gateway (ports/privacy.ts)  ← PolarPrivate
      → Agent Core (core/agent.ts)
        → LLM Router (ports/llm.ts)         ← 阿里云百炼
        → Tool Executor (ports/tools.ts)
        → Memory Store (ports/memory.ts)     ← SQLite + FTS5
        → Conversation History               ← 多轮对话
        → Skill Loader (ports/skills.ts)     ← Clock 等外部集成
        → Context Compressor (ports/compression.ts)
```

## 目录结构

```
src/
├── ports/              ← 接口定义（不依赖任何实现）
│   ├── channel.ts
│   ├── compression.ts
│   ├── learning.ts     ← 自学习系统接口
│   ├── llm.ts
│   ├── memory.ts
│   ├── privacy.ts
│   ├── skills.ts
│   ├── tools.ts
│   └── index.ts        ← 统一导出
├── adapters/           ← 接口实现（可替换）
│   ├── channel/        ← CLI、飞书适配器
│   ├── compression/    ← 三阶段上下文压缩
│   ├── learning/       ← 自学习系统（追踪/反馈/模式检测/技能生成/组合）
│   ├── llm/            ← LLM 路由器（Chat Completions 兼容）
│   ├── memory/         ← SQLite 存储 + 对话历史
│   ├── privacy/        ← PII 检测 + PolarPrivate 集成
│   ├── skills/         ← Skill 加载器 + SkillRegistry 热加载
│   ├── tools/          ← 工具执行器
│   ├── proactive/      ← 主动关怀引擎（调度 + 策略）
│   └── yolo/           ← YOLO 自主执行（引擎 + 恢复）
├── core/               ← Agent 核心（只依赖 ports）
│   └── agent.ts
├── config.ts
└── main.ts
skills/
├── clock-integration/       ← PolarClock 集成技能
├── autooffice-integration/  ← AutoOffice 报告引擎集成
└── knowlever-integration/   ← KnowLever 知识检索集成
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
- **自学习技能**：工具使用追踪 → 模式检测 → 自动技能生成 → 工作流组合
- **主动关怀**：定时/条件触发关怀消息，不活跃检测 + 番茄钟结束提醒
- **YOLO 模式**：自主多步执行，token/步数/时间预算保护 + 自动错误恢复
- **Clock 集成**：番茄钟状态感知，根据用户工作状态调整行为
