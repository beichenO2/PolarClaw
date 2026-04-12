import { execSync, spawn } from "node:child_process";
import { resolve, normalize } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_COMMAND_ALLOWLIST = new Set([
  "node", "npm", "npx", "git", "ls", "cat", "echo", "mkdir", "cp",
  "curl", "wget", "python3", "pip3",
]);

const DEFAULT_ENV_PASSTHROUGH = new Set([
  "PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "NODE_ENV",
  "MYCLAW_LLM_API_KEY", "DASHSCOPE_API_KEY",
  "TELEGRAM_BOT_TOKEN", "FEISHU_APP_ID", "FEISHU_APP_SECRET",
]);

const DOCKER_IMAGE = "node:22-slim";

/**
 * @typedef {object} SandboxOptions
 * @property {string[]} [allowedCommands]
 * @property {string[]} [allowedPaths]
 * @property {string[]} [envPassthrough]
 * @property {"process"|"docker"|"sandbox-exec"} [isolationLevel]
 */

/**
 * @param {SandboxOptions} [options]
 */
export function createSandboxManager(options = {}) {
  const allowedCommands = new Set(
    options.allowedCommands ?? DEFAULT_COMMAND_ALLOWLIST
  );
  const allowedPaths = (options.allowedPaths ?? []).map((p) =>
    normalize(resolve(p))
  );
  const envPassthrough = new Set(
    options.envPassthrough ?? DEFAULT_ENV_PASSTHROUGH
  );
  const isolationLevel = options.isolationLevel ?? detectIsolation();

  function detectIsolation() {
    try {
      execSync("docker --version", { encoding: "utf-8", timeout: 3000 });
      return "docker";
    } catch {
      if (process.platform === "darwin") return "sandbox-exec";
      return "process";
    }
  }

  function isCommandAllowed(command) {
    if (!command || typeof command !== "string") return false;
    const bin = command.trim().split(/\s+/)[0];
    const baseName = bin.split("/").pop();
    return allowedCommands.has(baseName);
  }

  function isPathAllowed(targetPath) {
    if (!targetPath) return false;
    const abs = normalize(resolve(targetPath));
    if (allowedPaths.length === 0) return true;
    return allowedPaths.some(
      (ap) => abs === ap || abs.startsWith(ap + "/")
    );
  }

  function filterEnv(env = process.env) {
    const filtered = {};
    for (const [k, v] of Object.entries(env)) {
      if (envPassthrough.has(k)) filtered[k] = v;
    }
    return filtered;
  }

  function execSandboxed(command, opts = {}) {
    if (!isCommandAllowed(command)) {
      throw new Error(`Sandbox: command not allowed: "${command.split(/\s+/)[0]}"`);
    }
    if (opts.cwd && !isPathAllowed(opts.cwd)) {
      throw new Error(`Sandbox: path not allowed: "${opts.cwd}"`);
    }
    const timeout = opts.timeout ?? 30_000;

    if (isolationLevel === "docker") {
      return execDocker(command, opts.cwd, timeout);
    }
    if (isolationLevel === "sandbox-exec") {
      return execMacSandbox(command, opts.cwd, timeout);
    }
    return execSync(command, {
      cwd: opts.cwd,
      env: filterEnv(),
      timeout,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  function execDocker(command, cwd, timeout) {
    const args = [
      "run", "--rm",
      "--network", "none",
      "--memory", "512m",
      "--cpus", "1",
      "--read-only",
      "--tmpfs", "/tmp:rw,size=64m",
    ];
    if (cwd && existsSync(cwd)) {
      args.push("-v", `${cwd}:/workspace:ro`, "-w", "/workspace");
    }
    const env = filterEnv();
    for (const [k, v] of Object.entries(env)) {
      args.push("-e", `${k}=${v}`);
    }
    args.push(DOCKER_IMAGE, "sh", "-c", command);
    return execSync(`docker ${args.map(a => `'${a}'`).join(" ")}`, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  function execMacSandbox(command, cwd, timeout) {
    const profile = `
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/usr") (subpath "/bin") (subpath "/Library") (subpath "/System") (subpath "/private/tmp"))
${cwd ? `(allow file-read* (subpath "${cwd}"))` : ""}
(allow file-write* (subpath "/private/tmp"))
(allow sysctl-read)
(allow mach-lookup)
    `.trim();
    return execSync(`sandbox-exec -p '${profile}' /bin/sh -c '${command.replace(/'/g, "'\\''")}'`, {
      cwd,
      env: filterEnv(),
      timeout,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  /**
   * Spawn a long-running process in an isolated environment.
   * @returns {import("child_process").ChildProcess}
   */
  function spawnIsolated(command, args = [], opts = {}) {
    const bin = command.split("/").pop();
    if (!allowedCommands.has(bin)) {
      throw new Error(`Sandbox: command not allowed: "${bin}"`);
    }
    if (isolationLevel === "docker") {
      const dockerArgs = [
        "run", "--rm", "-i",
        "--network", "none", "--memory", "512m", "--cpus", "1",
      ];
      if (opts.cwd) dockerArgs.push("-v", `${opts.cwd}:/workspace:ro`, "-w", "/workspace");
      dockerArgs.push(DOCKER_IMAGE, command, ...args);
      return spawn("docker", dockerArgs, { env: filterEnv(), stdio: opts.stdio ?? "pipe" });
    }
    return spawn(command, args, {
      cwd: opts.cwd,
      env: filterEnv(),
      stdio: opts.stdio ?? "pipe",
      timeout: opts.timeout ?? 60_000,
    });
  }

  function addCommand(cmd) { allowedCommands.add(cmd); }
  function removeCommand(cmd) { allowedCommands.delete(cmd); }
  function addPath(p) { allowedPaths.push(normalize(resolve(p))); }

  return {
    isCommandAllowed,
    isPathAllowed,
    filterEnv,
    execSandboxed,
    spawnIsolated,
    addCommand,
    removeCommand,
    addPath,
    get isolationLevel() { return isolationLevel; },
    get allowedCommands() { return [...allowedCommands]; },
    get allowedPaths() { return [...allowedPaths]; },
  };
}
