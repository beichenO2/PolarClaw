---
name: claude-code-executor
version: 1.0.0
description: Wraps Claude Code CLI for autonomous coding tasks
author: MyClaw
tags: [coding, automation, claude, executor]
triggers: [code, implement, fix, refactor, debug, build]
---

# Claude Code Executor

## What

This skill delegates **coding work** to the **Claude Code CLI** (`claude` from `@anthropic-ai/claude-code`). MyClaw (or another orchestrator) describes a task in natural language; the wrapper runs a non-interactive one-shot invocation and returns consolidated stdout/stderr plus timing and exit status.

## When to use

Use for **multi-file or non-trivial** work where the model should explore the tree, edit several files, run checks, or iterate:

- Implementing or extending features across modules
- Refactors that touch many call sites
- Debugging that needs reproduction steps, logs, and fixes
- Builds or test fixes that require the CLI’s tool loop

Avoid for trivial one-line edits that the host agent can do directly with file tools, or when Claude Code is not installed on the host.

## How it works

1. Resolve a **working directory** (project root or explicit `cwd`).
2. Spawn the `claude` process with **`--print`** (non-interactive / print mode) and **`--yolo`** (autonomous execution without interactive approval prompts, per Claude Code CLI semantics).
3. Pass the **task description** as the prompt argument.
4. Stream or buffer **stdout** and **stderr**, enforce an optional **timeout**, then return `{ success, output, duration }`.

Programmatic entry point: `executor.mjs` exports `executeClaudeCode(task, options)`.

## Parameters

| Input | Meaning |
|--------|---------|
| **task** | Natural-language instruction: what to build, fix, or verify. Be specific about files, acceptance criteria, and commands to run. |
| **working directory** | `cwd` in options: repository or folder the CLI should treat as context (must exist). Defaults to `process.cwd()` if omitted. |
| **constraints** | Optional `extraArgs`: additional CLI flags; `env` overrides; `timeoutMs` (default 30 minutes); `claudeBin` to override the binary name or path. |

## Examples

- “Implement user authentication with email/password, sessions in cookies, and a `/login` route; add minimal tests.”
- “Fix the database connection bug: `ECONNREFUSED` on startup when `DATABASE_URL` uses IPv6; make the pool retry and log clearly.”
- “Refactor `packages/api` to use the shared logger from `packages/core`; no behavior change.”

## Safety and CLI notes

- **`--yolo`** reduces prompts and is suited to **trusted** workspaces; use a dedicated clone or branch for risky tasks.
- If your Claude Code version prefers explicit permission bypass in print mode, pass `extraArgs: ['--permission-mode', 'bypassPermissions']` via `executeClaudeCode` options.
- Requires `claude` on `PATH` (typically `npm install -g @anthropic-ai/claude-code`).

## Integration (MyClaw)

From Node (e.g. a tool handler):

```javascript
import { executeClaudeCode } from './skills/claude-code/executor.mjs';

const { success, output, duration, exitCode, error } = await executeClaudeCode(
  'Fix failing tests in packages/foo',
  { cwd: '/path/to/repo', timeoutMs: 900_000 }
);
```
