import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "./parse.mjs";

const SKILL_FILE = "SKILL.md";

/** @param {string} dir */
async function* walkFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

/**
 * @param {string} skillMdPath
 * @param {string} raw
 */
function metaFromFile(skillMdPath, raw) {
  const { frontmatter, body } = parseSkillMarkdown(raw);
  const dir = path.dirname(skillMdPath);
  const folderName = path.basename(dir);
  const name = (frontmatter.name || folderName).trim().slice(0, 64);
  let description = (frontmatter.description || "").trim();
  if (!description) {
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) {
        description = t;
        break;
      }
    }
  }
  if (description.length > 1024) {
    description = `${description.slice(0, 1021)}...`;
  }
  return {
    id: name,
    name,
    description,
    skillDir: dir,
    skillFile: skillMdPath,
    version: frontmatter.version || null,
    frontmatter,
  };
}

/**
 * @typedef {object} SkillSummary
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} skillDir
 * @property {string} skillFile
 * @property {string | null} version
 * @property {Record<string, string>} frontmatter
 * @property {string} searchRoot
 */

/**
 * Discover skills under search roots (order = precedence: first root wins on name conflict).
 *
 * @param {string[]} searchRoots
 * @returns {Promise<SkillSummary[]>}
 */
export async function discoverSkills(searchRoots) {
  /** @type {Map<string, SkillSummary>} */
  const byName = new Map();

  for (const root of searchRoots) {
    for await (const file of walkFiles(root)) {
      if (path.basename(file) !== SKILL_FILE) continue;
      let raw;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const meta = metaFromFile(file, raw);
      if (!meta.name) continue;
      if (!byName.has(meta.name)) {
        byName.set(meta.name, {
          ...meta,
          searchRoot: root,
        });
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string[]} searchRoots
 * @param {string} skillId
 * @returns {Promise<import('./types.d.ts').SkillDetail | null>}
 */
export async function loadSkill(searchRoots, skillId) {
  const list = await discoverSkills(searchRoots);
  const found = list.find((s) => s.id === skillId || s.name === skillId);
  if (!found) return null;
  const raw = await fs.readFile(found.skillFile, "utf8");
  const { frontmatter, body } = parseSkillMarkdown(raw);
  return {
    ...found,
    frontmatter,
    body,
    raw,
  };
}

/**
 * @param {string} skillDir
 * @param {string} relativePath
 * @returns {Promise<string | null>} file text or null
 */
export async function loadSkillRelativeFile(skillDir, relativePath) {
  const safe = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(skillDir, safe);
  if (!full.startsWith(path.resolve(skillDir))) return null;
  try {
    return await fs.readFile(full, "utf8");
  } catch {
    return null;
  }
}
