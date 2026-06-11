# PolarClaw — AI Agent Operating System

A hexagonal-architecture AI agent framework with multi-model routing, semantic memory, self-learning skills, and autonomous execution. Part of the [Polarisor](https://github.com/beichenO2/Polarisor) ecosystem.

```bash
# Install via Polarisor ecosystem
git clone https://github.com/beichenO2/Polarisor.git && cd Polarisor && ./install.sh ai-agent

# Or standalone
git clone https://github.com/beichenO2/PolarClaw.git && cd PolarClaw && npm install
```

## Architecture

```
User ← Feishu/CLI/Web →
  Channel Adapter (ports/channel.ts)
    → Privacy Gateway (ports/privacy.ts)
      → Agent Core (core/agent.ts)
        → LLM Router (ports/llm.ts)           ← Multi-model routing
        → Tool Executor (ports/tools.ts)
        → Memory Store (ports/memory.ts)       ← SQLite + FTS5 semantic blocks
        → Conversation History                 ← Multi-turn with compression
        → Skill Loader (ports/skills.ts)       ← Hot-reload skill ecosystem
        → Context Compressor (ports/compression.ts)
        → YOLO Engine (adapters/yolo/)         ← Autonomous multi-step execution
        → Proactive Care (adapters/proactive/) ← Context-aware outreach
```

## Key Features

- **Multi-model LLM routing** — Intent-based model selection with fallback chains and cost optimization
- **Semantic memory blocks** — Compress unstructured knowledge into high-density retrievable blocks (see `memory/`)
- **Self-learning skills** — Tool usage tracking → pattern detection → automatic skill generation → workflow composition
- **YOLO autonomous execution** — Multi-step task execution with token/step/time budgets + automatic error recovery
- **Hexagonal architecture** — Ports & adapters pattern, any module independently replaceable
- **Privacy gateway** — Automatic PII detection + secret interception via PolarPrivate integration
- **Proactive care engine** — Scheduled/conditional outreach, inactivity detection, context-aware messaging
- **Context compression** — 3-stage compression for long conversations (summary → prune → compress)

## Directory Structure

```
src/
├── ports/              ← Interface definitions (no implementation deps)
│   ├── channel.ts      ← Input/output channel interface
│   ├── llm.ts          ← LLM provider interface
│   ├── memory.ts       ← Memory store interface
│   ├── privacy.ts      ← Privacy gateway interface
│   ├── skills.ts       ← Skill loading interface
│   ├── tools.ts        ← Tool execution interface
│   └── compression.ts  ← Context compression interface
├── adapters/           ← Implementations (swappable)
│   ├── channel/        ← CLI, Feishu, Web adapters
│   ├── llm/            ← LLM router (Chat Completions compatible)
│   ├── memory/         ← SQLite storage + conversation history
│   ├── privacy/        ← PII detection + PolarPrivate integration
│   ├── skills/         ← SkillRegistry with hot-reload
│   ├── tools/          ← Tool executor
│   ├── proactive/      ← Care engine (scheduler + strategies)
│   ├── yolo/           ← YOLO engine (execution + recovery)
│   ├── learning/       ← Self-learning (tracking/feedback/patterns/generation)
│   └── compression/    ← 3-stage context compression
├── core/
│   └── agent.ts        ← Agent orchestrator (depends only on ports)
├── config.ts
└── main.ts

memory/                 ← PolarMemory subsystem (semantic memory blocks)
├── src/
│   ├── block-store.ts  ← Block CRUD + FTS5 search
│   ├── compressor.ts   ← Knowledge compression
│   └── retriever.ts    ← Semantic retrieval
└── tests/

web/                    ← Agent web interface
```

## Quick Start

```bash
cp .env.example .env    # Fill in your LLM API keys
npm install
npm run dev             # Start the agent
```

## Self-Learning System

PolarClaw includes a complete self-learning infrastructure:

1. **Usage Tracking** — Wraps tool executor, records every call (params, results, timing)
2. **Pattern Detection** — Sliding window + sequence hashing detects repeated tool call patterns
3. **Skill Generation** — When pattern threshold is met, auto-generates candidate skills
4. **Skill Promotion** — Skills used successfully ≥ 3 times auto-promote to `verified` status

## Dependencies

| Project | Role | Required? |
|---------|------|-----------|
| [Agent_core](https://github.com/beichenO2/Agent_core) | Design rules & protocols | Recommended |
| [PolarPrivate](https://github.com/beichenO2/PolarPrivate) | LLM proxy + secret management | Optional |
| [PolarPilot](https://github.com/beichenO2/PolarPilot) | Autonomous planning skill | Optional |

## License

MIT
