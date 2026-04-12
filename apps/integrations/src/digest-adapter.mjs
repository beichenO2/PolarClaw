/**
 * Digest (信息获取) adapter — REQ-E06
 * Bridges MyClaw to the Digest project's crawl API and preprocessor.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIGEST_DIR = "/Users/mac/Library/Mobile Documents/com~apple~CloudDocs/Tools/digist";
const ENGINE_PATH = join(DIGEST_DIR, "src/engine.ts");
const SCRAPERS_DIR = join(DIGEST_DIR, "src/scrapers");

const SUPPORTED_PLATFORMS = [
  "twitter", "reddit", "wechat", "bilibili",
  "xiaohongshu", "github", "hackernews", "arxiv",
];

export function createDigestAdapter(options = {}) {
  const digestDir = options.digestDir ?? DIGEST_DIR;
  const timeout = options.timeoutMs ?? 60_000;

  function isAvailable() {
    return existsSync(join(digestDir, "src/engine.ts"));
  }

  /**
   * Crawl a URL or query using the Digest engine.
   * @param {{ url?: string, query?: string, platform?: string, limit?: number }} params
   */
  async function crawl(params) {
    if (!isAvailable()) {
      return { ok: false, error: "Digest project not found at " + digestDir };
    }

    const { url, query, platform, limit = 10 } = params;
    if (!url && !query) {
      return { ok: false, error: "Either url or query is required" };
    }

    try {
      const args = [];
      if (url) args.push(`--url "${url}"`);
      if (query) args.push(`--query "${query}"`);
      if (platform) args.push(`--platform ${platform}`);
      args.push(`--limit ${limit}`);
      args.push("--format markdown");

      const cmd = `cd "${digestDir}" && node dist/cli.js crawl ${args.join(" ")}`;
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { ok: true, content: output.trim(), format: "markdown" };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Preprocess a file (PDF, audio, etc.) to Markdown.
   * @param {{ filePath: string, type?: string }} params
   */
  async function preprocess(params) {
    if (!isAvailable()) {
      return { ok: false, error: "Digest project not found" };
    }

    const { filePath, type } = params;
    if (!filePath || !existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` };
    }

    try {
      const args = [`--input "${filePath}"`];
      if (type) args.push(`--type ${type}`);
      args.push("--output-format markdown");

      const cmd = `cd "${digestDir}" && node dist/cli.js preprocess ${args.join(" ")}`;
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: timeout * 2,
        maxBuffer: 20 * 1024 * 1024,
      });
      return { ok: true, markdown: output.trim() };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  function listPlatforms() {
    if (!isAvailable()) return [];
    try {
      const files = execSync(`ls "${SCRAPERS_DIR}"`, { encoding: "utf-8" })
        .trim().split("\n").filter(Boolean);
      return files.map(f => f.replace(/\.(ts|js|mjs)$/, ""));
    } catch {
      return SUPPORTED_PLATFORMS;
    }
  }

  return {
    isAvailable,
    crawl,
    preprocess,
    listPlatforms,
    digestDir,
  };
}
