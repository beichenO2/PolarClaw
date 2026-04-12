import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @typedef {object} ExecuteClaudeCodeOptions
 * @property {string} [cwd] - Working directory (default: process.cwd())
 * @property {number} [timeoutMs] - Kill after this many ms (default: 1_800_000 = 30 min)
 * @property {string} [claudeBin] - Binary name or absolute path (default: env MYCLAW_CLAUDE_BIN or "claude")
 * @property {string[]} [extraArgs] - Extra CLI args inserted before the prompt
 * @property {NodeJS.ProcessEnv} [env] - Env for the child (merged over process.env)
 */

/**
 * @typedef {object} ExecuteClaudeCodeResult
 * @property {boolean} success - True when exit code is 0 and no spawn error
 * @property {string} output - Combined stdout + stderr (chronological interleaving not guaranteed across streams)
 * @property {number} duration - Elapsed time in milliseconds
 * @property {number | null} exitCode - Process exit code, or null if killed/error before exit
 * @property {string | null} error - Short error message (spawn failure, timeout, missing cwd)
 */

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes

/**
 * Runs: claude --print --yolo "<task>" (plus optional extraArgs)
 * @param {string} task
 * @param {ExecuteClaudeCodeOptions} [options]
 * @returns {Promise<ExecuteClaudeCodeResult>}
 */
export function executeClaudeCode(task, options = {}) {
  const cwd = options.cwd != null ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const claudeBin = options.claudeBin ?? process.env.MYCLAW_CLAUDE_BIN ?? "claude";
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  const start = Date.now();

  if (!existsSync(cwd)) {
    return Promise.resolve({
      success: false,
      output: "",
      duration: Date.now() - start,
      exitCode: null,
      error: `cwd does not exist: ${cwd}`,
    });
  }

  if (typeof task !== "string" || !task.trim()) {
    return Promise.resolve({
      success: false,
      output: "",
      duration: Date.now() - start,
      exitCode: null,
      error: "task must be a non-empty string",
    });
  }

  const args = ["--print", "--yolo", ...extraArgs, task.trim()];

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(claudeBin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const killTree = () => {
      if (!child.pid) return;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 5_000);
      t.unref?.();
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            killTree();
            const duration = Date.now() - start;
            resolvePromise({
              success: false,
              output: joinOutput(stdout, stderr),
              duration,
              exitCode: null,
              error: `timeout after ${timeoutMs}ms`,
            });
          }, timeoutMs)
        : null;
    if (timer) timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const duration = Date.now() - start;
      resolvePromise({
        success: false,
        output: joinOutput(stdout, stderr),
        duration,
        exitCode: null,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const duration = Date.now() - start;
      const exitCode = code;

      let error = null;
      if (signal) {
        error = `terminated by signal ${signal}`;
      } else if (exitCode !== 0 && exitCode !== null) {
        error = `exit code ${exitCode}`;
      }

      resolvePromise({
        success: exitCode === 0,
        output: joinOutput(stdout, stderr),
        duration,
        exitCode,
        error,
      });
    });
  });
}

/**
 * @param {string} a
 * @param {string} b
 */
function joinOutput(a, b) {
  if (!a) return b;
  if (!b) return a;
  return `${a}\n--- stderr ---\n${b}`;
}

export default { executeClaudeCode };
