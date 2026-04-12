import { readFile } from "node:fs/promises";
import path from "node:path";

const AGENTS = "AGENTS.md";
const SOUL = "SOUL.md";

/**
 * @typedef {object} AssemblePromptOptions
 * @property {string | string[]} [append] Extra markdown blocks appended after SOUL/AGENTS (each separated by ---).
 */

/**
 * Reads AGENTS.md and SOUL.md from `dir`, normalizes line endings, and returns a single system prompt string.
 * Missing files are treated as empty sections; if both are missing, throws.
 *
 * @param {string} dir Absolute or relative directory path
 * @param {AssemblePromptOptions} [options]
 * @returns {Promise<string>}
 */
export async function assemblePrompt(dir, options = {}) {
  if (typeof dir !== "string" || dir.trim() === "") {
    throw new TypeError("assemblePrompt(dir): dir must be a non-empty string");
  }

  const base = path.resolve(dir);
  const agentsPath = path.join(base, AGENTS);
  const soulPath = path.join(base, SOUL);

  let agentsText = "";
  let soulText = "";

  try {
    agentsText = await readFile(agentsPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  try {
    soulText = await readFile(soulPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  if (agentsText === "" && soulText === "") {
    throw new Error(
      `assemblePrompt: neither ${AGENTS} nor ${SOUL} found in ${base}`
    );
  }

  const parts = [];

  if (soulText.trim() !== "") {
    parts.push("# SOUL\n\n" + soulText.trimEnd());
  }

  if (agentsText.trim() !== "") {
    parts.push("# AGENTS\n\n" + agentsText.trimEnd());
  }

  let out = parts.join("\n\n---\n\n");
  const append = options.append;
  if (append != null) {
    const blocks = Array.isArray(append) ? append : [append];
    for (const b of blocks) {
      const t = String(b ?? "").trim();
      if (t) {
        out += "\n\n---\n\n" + t;
      }
    }
  }
  return out;
}
