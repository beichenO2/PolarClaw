/**
 * MCP Bridge — REQ-I08, REQ-I09
 * Standardized integration layer for MCP protocol tools.
 * Supports: OpenTwitter MCP, any MCP-compatible server.
 *
 * Uses mcp-use pattern for standardized tool consumption.
 */

import { execSync, spawn } from "node:child_process";

/**
 * @typedef {{ name: string, command: string, args?: string[], env?: Record<string,string> }} McpServerConfig
 */

/**
 * @typedef {{ name: string, description: string, inputSchema?: object }} McpTool
 */

export function createMcpBridge(options = {}) {
  const timeout = options.timeoutMs ?? 30_000;
  /** @type {Map<string, import("child_process").ChildProcess>} */
  const runningServers = new Map();
  /** @type {Map<string, McpTool[]>} */
  const toolCatalogs = new Map();

  /**
   * Register an MCP server configuration.
   * @param {McpServerConfig} config
   */
  function registerServer(config) {
    if (!config.name || !config.command) {
      throw new Error("MCP server config requires name and command");
    }
    toolCatalogs.set(config.name, []);
    return { ok: true, server: config.name };
  }

  /**
   * Start an MCP server process.
   * @param {string} serverName
   * @param {McpServerConfig} config
   */
  async function startServer(serverName, config) {
    if (runningServers.has(serverName)) {
      return { ok: true, message: "Already running" };
    }

    try {
      const proc = spawn(config.command, config.args ?? [], {
        env: { ...process.env, ...(config.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      runningServers.set(serverName, proc);

      proc.on("exit", (code) => {
        runningServers.delete(serverName);
      });

      return { ok: true, pid: proc.pid, server: serverName };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Stop an MCP server.
   * @param {string} serverName
   */
  function stopServer(serverName) {
    const proc = runningServers.get(serverName);
    if (proc) {
      proc.kill("SIGTERM");
      runningServers.delete(serverName);
      return { ok: true, stopped: serverName };
    }
    return { ok: false, error: "Server not running" };
  }

  /**
   * Register OpenTwitter MCP as a source.
   * @param {{ apiKey?: string }} opts
   */
  function registerOpenTwitter(opts = {}) {
    const config = {
      name: "opentwitter",
      command: "npx",
      args: ["opentwitter-mcp"],
      env: opts.apiKey ? { TWITTER_API_KEY: opts.apiKey } : {},
    };
    registerServer(config);

    toolCatalogs.set("opentwitter", [
      { name: "twitter_search", description: "Search tweets by keyword" },
      { name: "twitter_user_timeline", description: "Get user's recent tweets" },
      { name: "twitter_trends", description: "Get trending topics" },
      { name: "twitter_thread", description: "Get full tweet thread" },
    ]);

    return { ok: true, tools: toolCatalogs.get("opentwitter") };
  }

  /** Auto-incrementing JSON-RPC request id. */
  let rpcId = 1;

  /**
   * Send a JSON-RPC 2.0 request to a running MCP server via stdio.
   * @param {string} serverName
   * @param {string} method
   * @param {object} [rpcParams]
   * @returns {Promise<object>}
   */
  function sendRpc(serverName, method, rpcParams = {}) {
    const proc = runningServers.get(serverName);
    if (!proc?.stdin?.writable) {
      throw new Error(`Server ${serverName} stdin not writable`);
    }

    const id = rpcId++;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: rpcParams,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`MCP RPC timeout (${timeout}ms) for ${method}`));
      }, timeout);

      let buffer = "";

      function onData(chunk) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.id === id) {
              cleanup();
              if (parsed.error) {
                reject(new Error(parsed.error.message ?? JSON.stringify(parsed.error)));
              } else {
                resolve(parsed.result ?? parsed);
              }
              return;
            }
          } catch { /* not our response yet */ }
        }
        buffer = lines[lines.length - 1] ?? "";
      }

      function cleanup() {
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
      }

      proc.stdout?.on("data", onData);
      proc.stdin.write(request + "\n");
    });
  }

  /**
   * Call an MCP tool on a registered server via JSON-RPC over stdio.
   * @param {{ server: string, tool: string, args?: object }} params
   */
  async function callTool(params) {
    const { server, tool, args = {} } = params;
    if (!toolCatalogs.has(server)) {
      return { ok: false, error: `Server ${server} not registered` };
    }

    const tools = toolCatalogs.get(server);
    if (!tools.some(t => t.name === tool)) {
      return { ok: false, error: `Tool ${tool} not found on server ${server}` };
    }

    if (!runningServers.has(server)) {
      return { ok: false, error: `Server ${server} not started. Call startServer first.` };
    }

    try {
      const result = await sendRpc(server, "tools/call", {
        name: tool,
        arguments: args,
      });
      return { ok: true, result, server, tool };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * List all registered servers and their tools.
   */
  function listServers() {
    const result = {};
    for (const [name, tools] of toolCatalogs) {
      result[name] = {
        running: runningServers.has(name),
        tools: tools.map(t => t.name),
      };
    }
    return result;
  }

  function stopAll() {
    for (const [name] of runningServers) {
      stopServer(name);
    }
  }

  return {
    registerServer,
    startServer,
    stopServer,
    stopAll,
    registerOpenTwitter,
    callTool,
    listServers,
  };
}
