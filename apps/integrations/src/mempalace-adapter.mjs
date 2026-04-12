/**
 * MemPalace adapter — REQ-I01 (MASTER-PLAN §8.2 第一优先级)
 * Integrates MemPalace memory system as a complementary memory backend.
 *
 * MemPalace provides:
 * - Spatial memory organization (Wings → Rooms → Halls → Closets → Drawers)
 * - 19+ MCP tools for read/write/search
 * - Agent diaries for persistent cross-session notes
 * - Knowledge graph with temporal awareness
 * - ChromaDB vector search + SQLite metadata
 *
 * Strategy: Use MemPalace for high-level semantic memory (user profile, long-term
 * knowledge), keep existing SQLite+FTS5 for operational memory (recent interactions,
 * task state). This avoids migration risk while gaining MemPalace's strengths.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_PALACE_DIR = resolve(process.env.HOME ?? "~", ".mempalace/myclaw");

export function createMemPalaceAdapter(options = {}) {
  const palaceDir = options.palaceDir ?? DEFAULT_PALACE_DIR;
  const pythonBin = options.pythonBin ?? "python3";
  const timeout = options.timeoutMs ?? 30_000;

  let initialized = false;

  function isInstalled() {
    try {
      execSync(`${pythonBin} -c "import mempalace"`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  function isInitialized() {
    return existsSync(join(palaceDir, "chroma")) ||
           existsSync(join(palaceDir, "mempalace.db"));
  }

  async function initialize() {
    if (!isInstalled()) {
      return { ok: false, error: "mempalace not installed. Run: pip3 install mempalace" };
    }

    if (isInitialized()) {
      initialized = true;
      return { ok: true, message: "Already initialized", palaceDir };
    }

    try {
      mkdirSync(palaceDir, { recursive: true });
      execSync(`${pythonBin} -m mempalace init "${palaceDir}" --yes`, {
        encoding: "utf-8",
        timeout,
      });
      initialized = true;
      return { ok: true, message: "Initialized", palaceDir };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Store a memory in MemPalace.
   * @param {{ content: string, wing?: string, room?: string, tags?: string[] }} params
   */
  async function store(params) {
    if (!initialized && !isInitialized()) {
      const init = await initialize();
      if (!init.ok) return init;
    }

    const { content, wing = "general", room = "default", tags = [] } = params;
    if (!content) return { ok: false, error: "content is required" };

    try {
      const tagsArg = tags.length ? `--tags "${tags.join(",")}"` : "";
      const escapedContent = content.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const cmd = `${pythonBin} -c "
from mempalace.api import MemPalaceAPI
mp = MemPalaceAPI('${palaceDir}')
result = mp.store_memory('${wing}', '${room}', \\"${escapedContent.slice(0, 10000)}\\")
print(result)
"`;
      const output = execSync(cmd, { encoding: "utf-8", timeout });
      return { ok: true, result: output.trim() };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Search memories in MemPalace.
   * @param {{ query: string, limit?: number, wing?: string }} params
   */
  async function search(params) {
    const { query, limit = 5, wing } = params;
    if (!query) return { ok: false, error: "query is required", results: [] };

    try {
      const wingFilter = wing ? `, wing='${wing}'` : "";
      const cmd = `${pythonBin} -c "
import json
from mempalace.api import MemPalaceAPI
mp = MemPalaceAPI('${palaceDir}')
results = mp.search('${query.replace(/'/g, "\\'")}'${wingFilter}, limit=${limit})
print(json.dumps(results, ensure_ascii=False, default=str))
"`;
      const output = execSync(cmd, { encoding: "utf-8", timeout });
      const results = JSON.parse(output.trim());
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err), results: [] };
    }
  }

  /**
   * Write to the agent diary (private persistent notes).
   * @param {{ entry: string, topic?: string }} params
   */
  async function writeDiary(params) {
    const { entry, topic = "general" } = params;
    if (!entry) return { ok: false, error: "entry is required" };

    try {
      const cmd = `${pythonBin} -c "
from mempalace.api import MemPalaceAPI
mp = MemPalaceAPI('${palaceDir}')
result = mp.diary_write('${topic}', '${entry.replace(/'/g, "\\'").slice(0, 5000)}')
print(result)
"`;
      const output = execSync(cmd, { encoding: "utf-8", timeout });
      return { ok: true, result: output.trim() };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Get the MCP server command for external integration.
   */
  function getMcpServerCommand() {
    return `${pythonBin} -m mempalace.mempalace.mcp_server --palace-dir "${palaceDir}"`;
  }

  /**
   * Get status of the MemPalace installation.
   */
  function getStatus() {
    return {
      installed: isInstalled(),
      initialized: isInitialized(),
      palaceDir,
      mcpCommand: getMcpServerCommand(),
    };
  }

  return {
    initialize,
    store,
    search,
    writeDiary,
    getStatus,
    getMcpServerCommand,
    isInstalled,
    isInitialized,
    palaceDir,
  };
}
