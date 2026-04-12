/**
 * CLI Anything + VPN Degradation — REQ-I07 (MASTER-PLAN §8.2)
 *
 * 1. CLI Anything: Convert any open-source tool to a callable CLI tool
 * 2. VPN Degradation: When network is down, fall back to local Gemma model
 */

import { execSync } from "node:child_process";

export function createCliAnything(options = {}) {
  const timeout = options.timeoutMs ?? 30_000;

  /**
   * Check if network is available.
   */
  function checkNetwork() {
    try {
      execSync("curl -s --max-time 3 https://httpbin.org/ip", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return { ok: true, network: "online" };
    } catch {
      return { ok: false, network: "offline" };
    }
  }

  /**
   * Check if local Gemma model is available for fallback.
   */
  function checkLocalModel() {
    try {
      execSync("ollama list 2>&1 | grep -i gemma", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return { ok: true, model: "gemma", available: true };
    } catch {
      return { ok: false, model: "gemma", available: false };
    }
  }

  /**
   * Execute a command with VPN degradation support.
   * If network is down and the command fails, provide fallback guidance.
   * @param {{ command: string, fallbackPrompt?: string }} params
   */
  async function executeWithFallback(params) {
    const { command, fallbackPrompt } = params;
    const network = checkNetwork();

    if (network.ok) {
      try {
        const output = execSync(command, {
          encoding: "utf-8",
          timeout,
          maxBuffer: 5 * 1024 * 1024,
        });
        return { ok: true, output: output.trim(), mode: "online" };
      } catch (err) {
        return { ok: false, error: err.message, mode: "online" };
      }
    }

    const localModel = checkLocalModel();
    if (localModel.available && fallbackPrompt) {
      try {
        const output = execSync(
          `ollama run gemma "${fallbackPrompt.replace(/"/g, '\\"')}"`,
          { encoding: "utf-8", timeout: timeout * 2 }
        );
        return { ok: true, output: output.trim(), mode: "offline-gemma" };
      } catch (err) {
        return { ok: false, error: err.message, mode: "offline-gemma-failed" };
      }
    }

    return {
      ok: false,
      error: "Network offline and no local Gemma model available",
      mode: "offline-no-fallback",
      suggestion: "Install Gemma: ollama pull gemma",
    };
  }

  /**
   * Convert a CLI tool to a callable function.
   * @param {{ name: string, command: string, argsTemplate?: string }} toolSpec
   */
  function wrapTool(toolSpec) {
    return async (args = {}) => {
      let cmd = toolSpec.command;
      if (toolSpec.argsTemplate) {
        let template = toolSpec.argsTemplate;
        for (const [k, v] of Object.entries(args)) {
          template = template.replace(`{${k}}`, String(v));
        }
        cmd = `${cmd} ${template}`;
      }
      return executeWithFallback({ command: cmd });
    };
  }

  function getStatus() {
    const network = checkNetwork();
    const localModel = checkLocalModel();
    return {
      network: network.network,
      localModelAvailable: localModel.available,
      degradationReady: localModel.available,
    };
  }

  return {
    checkNetwork,
    checkLocalModel,
    executeWithFallback,
    wrapTool,
    getStatus,
  };
}
