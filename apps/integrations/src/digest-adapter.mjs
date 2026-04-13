/**
 * Digest (信息获取) adapter — REQ-E06
 * Bridges MyClaw to the DiGist project via CLI (tsx) calls.
 *
 * DiGist uses OpenCLI for all platform scraping — no API keys needed.
 * Supported: twitter, xiaohongshu, zhihu, wechat, reddit, github,
 *            glass, arxiv, bilibili, hackernews, bloomberg
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const exec = promisify(execFile);

const DIGEST_DIR = join(homedir(), "Polarisor/digist");

const SUPPORTED_PLATFORMS = [
  "twitter", "reddit", "wechat", "github", "glass",
  "xiaohongshu", "zhihu", "arxiv", "bilibili", "hackernews", "bloomberg",
];

export function createDigestAdapter(options = {}) {
  const digestDir = options.digestDir ?? DIGEST_DIR;
  const timeout = options.timeoutMs ?? 120_000;

  function isAvailable() {
    return existsSync(join(digestDir, "src/cli.ts"));
  }

  async function runDigistCLI(args) {
    const { stdout } = await exec("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: digestDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return stdout.trim();
  }

  /**
   * Scrape content from a platform.
   * @param {{ query: string, platform?: string, limit?: number }} params
   */
  async function crawl(params) {
    if (!isAvailable()) {
      return { ok: false, error: "DiGist project not found at " + digestDir };
    }

    const { query, platform = "twitter", limit = 10 } = params;
    if (!query) {
      return { ok: false, error: "query is required" };
    }

    try {
      const output = await runDigistCLI(["scrape", platform, query]);
      return { ok: true, content: output, format: "text" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Search stored content in DiGist's database.
   */
  async function search(query) {
    if (!isAvailable()) return { ok: false, error: "DiGist not found" };
    try {
      const output = await runDigistCLI(["search", query]);
      return { ok: true, content: output };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Get DiGist statistics.
   */
  async function stats() {
    if (!isAvailable()) return { ok: false, error: "DiGist not found" };
    try {
      const output = await runDigistCLI(["stats"]);
      return { ok: true, content: output };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  function listPlatforms() {
    return SUPPORTED_PLATFORMS;
  }

  return {
    isAvailable,
    crawl,
    search,
    stats,
    listPlatforms,
    digestDir,
  };
}
