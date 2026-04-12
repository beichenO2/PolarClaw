# Claude Code executor (MyClaw skill)

Wraps the **Claude Code** CLI (`claude`) so MyClaw or other agents can run autonomous coding tasks and read the result as structured data.

## Prerequisites

- Node.js 18+ (uses `node:child_process` / ESM).
- Claude Code installed and on `PATH`, e.g.:

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

- Valid Claude / Anthropic authentication as required by your Claude Code install (API key or subscription flow).

## Files

| File | Role |
|------|------|
| `SKILL.md` | Agent-facing contract: when to use, parameters, examples (agentskills.io-style frontmatter). |
| `executor.mjs` | `executeClaudeCode(task, options)` — spawns `claude --print --yolo` with timeout and error handling. |

## Quick usage

From the repo root (adjust the import path to where this skill lives):

```javascript
import { executeClaudeCode } from "./skills/claude-code/executor.mjs";

const result = await executeClaudeCode(
  "Add a health check route that returns JSON { ok: true }",
  {
    cwd: "/absolute/path/to/your/project",
    timeoutMs: 600_000,
  }
);

console.log(result.success, result.duration, result.exitCode);
console.log(result.output);
if (result.error) console.error(result.error);
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `cwd` | `process.cwd()` | Working directory for the CLI. |
| `timeoutMs` | `1800000` (30 min) | After this, sends SIGTERM then SIGKILL. Use `0` to disable. |
| `claudeBin` | `MYCLAW_CLAUDE_BIN` or `claude` | Executable name or absolute path. |
| `extraArgs` | `[]` | Extra arguments before the prompt (e.g. permission mode flags). |
| `env` | `process.env` | Shallow merge into the child environment. |

### Return value

```ts
{
  success: boolean;   // exitCode === 0
  output: string;     // stdout + labeled stderr block
  duration: number;   // ms
  exitCode: number | null;
  error: string | null;  // spawn error, timeout, non-zero exit, or signal
}
```

## CLI flags

The wrapper runs:

`claude --print --yolo "<task>"`

If your installation documents different flags for non-interactive runs, pass them via `extraArgs` and/or set `claudeBin` / env in your integration layer.

## MyClaw scan dirs

Ensure your MyClaw config includes the directory that contains this skill (or the project root) in `skills.scanDirs` so `SKILL.md` is loaded into context. Invoking `executor.mjs` is done by your runtime or a custom tool, not automatically by frontmatter alone.
