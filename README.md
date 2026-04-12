# MyClaw

**MyClaw** is a multi-module AI assistant runtime that fuses ideas from **OpenClaw** (local control plane and gateway alignment), **DeerFlow** (coordinator–planner–reporter research pipeline), and **Claude Code**–style skills (declarative `SKILL.md` plus optional CLI delegation). It routes LLM calls through an OpenAI-compatible API (e.g. Alibaba Cloud DashScope), assembles prompts from project soul files and skills, and exposes tools for memory, research, channels, and more.

---

## Architecture overview

The repository is an **npm workspaces** monorepo. Application packages live under `apps/` as **`@myclaw/*`** modules. The root entrypoint **`start.mjs`** loads environment configuration, validates LLM credentials, and boots **`@myclaw/core`**, which wires routing, runtime, memory, skills, and optional integrations.

```text
MyClaw/
├── start.mjs              # Root entry — .env, validation, core agent
├── apps/                  # 14 workspace packages (@myclaw/*)
├── skills/                # OpenClaw-compatible skills (e.g. claude-code)
├── scripts/               # Repo-wide helpers (e.g. test-all.sh)
└── .env.example           # Environment template
```

---

## Quick start

### Prerequisites

- **Node.js** (version compatible with the repo’s `package.json` / engines if specified)
- An **LLM API key** for an OpenAI-compatible endpoint (DashScope / 百炼 or compatible)

### Setup

1. **Clone** the repository and install dependencies from the repo root:

   ```bash
   npm install
   ```

2. **Configure environment** — copy the example file and edit values:

   ```bash
   cp .env.example .env
   ```

3. **Set your API key** in `.env` (at minimum). The runtime accepts any of:

   - `MYCLAW_LLM_API_KEY`
   - `DASHSCOPE_API_KEY`
   - `OPENAI_API_KEY`

   Adjust `MYCLAW_LLM_BASE_URL` and `MYCLAW_LLM_DEFAULT_MODEL` if your provider or plan differs from the defaults in `.env.example`.

4. **Run** the agent from the repository root:

   ```bash
   npm start
   ```

   This executes `node start.mjs`. Optional: pass `--config` / `-c` with a config file path if your deployment uses a custom config (see core documentation).

---

## Modules (`apps/*`)

| Package | Role |
|--------|------|
| **`@myclaw/core`** | Orchestrator — connects gateway, LLM router, runtime, memory, skills, channels, and auxiliary modules into one agent runtime. |
| **`@myclaw/gateway`** | Control plane — wraps / aligns with OpenClaw Gateway (WebSocket URL, status); gateway process is started separately when needed. |
| **`@myclaw/llm`** | Intent-based model routing against an OpenAI-compatible Chat Completions API (e.g. DashScope). |
| **`@myclaw/runtime`** | Prompt assembly, OpenAI-compatible client, and tool execution loop. |
| **`@myclaw/skills`** | Discovers and parses OpenClaw-style `SKILL.md` files for injection into system context. |
| **`@myclaw/memory`** | SQLite + FTS5 memory store and user-profile fields for long-term recall and search. |
| **`@myclaw/research`** | Deep research engine — **Coordinator → Planner → Reporter** (DeerFlow-style), with configurable evidence sources. |
| **`@myclaw/telegram`** | Telegram bot integration (long polling, file bridge, task notifications). |
| **`@myclaw/feishu`** | Feishu / Lark bot — messages, files, cards, task-style notifications. |
| **`@myclaw/web`** | React + Vite dashboard (GitHub-inspired UI) for operating and inspecting the stack. |
| **`@myclaw/proactive`** | Scheduler and care-engine style proactive behaviors. |
| **`@myclaw/yolo`** | Autonomous execution layer with retry / recovery semantics (configurable). |
| **`@myclaw/evolution`** | Evolution jobs — skill synthesis signals, news/model catalog drift checks (e.g. when enabled via env). |
| **`@myclaw/content`** | Content pipeline — outlines/notes toward interactive single-page learning experiences. |

---

## Skills and Claude Code bridge

- **`skills/claude-code/`** — Contains `SKILL.md` (metadata, triggers, usage) and **`executor.mjs`**, which can delegate non-trivial coding work to the **Claude Code** CLI in non-interactive mode when installed on the host.

Skills are scanned according to core configuration (e.g. `skills.scanDirs`); placing compatible `SKILL.md` trees under `skills/` or the project root keeps behavior aligned with OpenClaw conventions.

---

## Development guide

### Common scripts (repository root)

| Script | Description |
|--------|-------------|
| `npm start` | Run `start.mjs` — full agent bootstrap. |
| `npm test` | Run `scripts/test-all.sh` — iterates `apps/*` and runs `npm test` where a test script exists. |
| `npm run dev:web` | Start the Vite dev server for `@myclaw/web`. |
| `npm run build:web` | Production build for the web dashboard. |
| `npm run lint` | Placeholder until a shared lint task is added. |

### Working on a single package

From the repo root, use workspace-aware installs and scripts, for example:

```bash
npm install -w @myclaw/runtime
npm run test -w @myclaw/memory
```

Or `cd apps/<module>` and use local `npm` commands when iterating.

### Environment flags

See **`.env.example`** for optional toggles (Telegram, Feishu, memory path, evolution interval, web port, etc.). Enabling channels usually requires both config/env **and** valid third-party credentials.

### Project voice and agent rules

Runtime system prompts can incorporate repository-level files such as **`SOUL.md`** and **`AGENTS.md`** (see core’s `assemblePrompt` behavior). Keep them in sync with how you want the assistant to behave in production.

---

## License and contributions

Add your preferred **LICENSE** and contribution guidelines if this repository is published publicly; this README assumes the codebase is the source of truth for behavior and configuration.

---

*MyClaw — OpenClaw-aligned control plane, DeerFlow-style research, and Claude Code–friendly skills in one workspace.*
