# PolarClaw — AI Agent 操作系统

六边形架构 AI Agent 框架，具备多模型路由、语义记忆、自学习技能生态和自主执行能力。[Polarisor](https://github.com/beichenO2/Polarisor) 生态核心。

```bash
# 通过 Polarisor 生态安装
git clone https://github.com/beichenO2/Polarisor.git && cd Polarisor && ./install.sh ai-agent

# 或独立安装
git clone https://github.com/beichenO2/PolarClaw.git && cd PolarClaw && npm install
```

## 架构

```
用户 ← 飞书/CLI/Web →
  Channel Adapter (ports/channel.ts)
    → Privacy Gateway (ports/privacy.ts)
      → Agent Core (core/agent.ts)
        → LLM Router (ports/llm.ts)           ← 多模型智能路由
        → Tool Executor (ports/tools.ts)
        → Memory Store (ports/memory.ts)       ← SQLite + FTS5 语义块
        → Conversation History                 ← 多轮对话 + 压缩
        → Skill Loader (ports/skills.ts)       ← 热加载技能生态
        → Context Compressor (ports/compression.ts)
        → YOLO Engine (adapters/yolo/)         ← 自主多步执行
        → Proactive Care (adapters/proactive/) ← 上下文感知主动关怀
```

## 核心特性

- **多模型 LLM 路由** — 基于意图的模型选择 + 降级链 + 成本优化
- **语义记忆块** — 将非结构化知识压缩为高密度可检索块（见 `memory/`）
- **自学习技能** — 工具使用追踪 → 模式检测 → 自动技能生成 → 工作流组合
- **YOLO 自主执行** — 多步任务执行，token/步数/时间预算保护 + 自动错误恢复
- **六边形架构** — 端口适配器模式，任何模块可独立替换
- **隐私网关** — 自动 PII 检测 + Secret 拦截
- **主动关怀引擎** — 定时/条件触发，不活跃检测，上下文感知消息
- **三阶段上下文压缩** — 长对话自动 summary → prune → compress

## 目录结构

```
src/
├── ports/              ← 接口定义（零实现依赖）
│   ├── channel.ts      ← 输入输出通道接口
│   ├── llm.ts          ← LLM 提供者接口
│   ├── memory.ts       ← 存储接口
│   ├── privacy.ts      ← 隐私网关接口
│   ├── skills.ts       ← 技能加载接口
│   ├── tools.ts        ← 工具执行接口
│   └── compression.ts  ← 上下文压缩接口
├── adapters/           ← 可替换实现
│   ├── channel/        ← CLI、飞书、Web 适配器
│   ├── llm/            ← LLM 路由器（Chat Completions 兼容）
│   ├── memory/         ← SQLite 存储 + 对话历史
│   ├── privacy/        ← PII 检测 + PolarPrivate 集成
│   ├── skills/         ← SkillRegistry 热加载
│   ├── tools/          ← 工具执行器
│   ├── proactive/      ← 关怀引擎（调度 + 策略）
│   ├── yolo/           ← YOLO 引擎（执行 + 恢复）
│   ├── learning/       ← 自学习系统（追踪/反馈/模式/生成）
│   └── compression/    ← 三阶段上下文压缩
├── core/
│   └── agent.ts        ← Agent 编排器（仅依赖 ports）
├── config.ts
└── main.ts

memory/                 ← PolarMemory 子系统（语义记忆块）
web/                    ← Agent Web 界面
docs/                   ← 设计文档
```

## 设计文档

- [设计理念与灵魂](docs/DESIGN.md) — 架构哲学、设计约束、核心原则

## 快速开始

```bash
cp .env.example .env    # 填入 LLM API Key
npm install
npm run dev             # 启动 Agent
```

## 自学习系统

PolarClaw 内置完整的自学习基础设施：

1. **使用追踪** — 包装工具执行器，自动记录每次调用（参数、结果、耗时）
2. **模式检测** — 滑动窗口 + 序列哈希检测重复工具调用模式
3. **技能生成** — 达到模式阈值时自动生成候选技能
4. **技能晋升** — 成功使用 ≥ 3 次自动晋升为 `verified` 状态

## 生态依赖

| 项目 | 角色 | 是否必须 |
|------|------|----------|
| [Agent_core](https://github.com/beichenO2/Agent_core) | 设计规则与协议 | 推荐 |
| [PolarPrivate](https://github.com/beichenO2/PolarPrivate) | LLM 代理 + 密钥管理 | 可选 |
| [PolarPilot](https://github.com/beichenO2/PolarPilot) | 自主规划技能 | 可选 |

## License

MIT
