import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile } from "./parse-skill.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Recursively find SKILL.md under root (max depth optional).
 *
 * @param {string} rootDir
 * @param {{ maxDepth?: number }} [opts]
 * @returns {string[]}
 */
export function findSkillFiles(rootDir, opts = {}) {
  const maxDepth = opts.maxDepth ?? 32;
  /** @type {string[]} */
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(p, depth + 1);
        continue;
      }
      if (ent.isFile() && ent.name === "SKILL.md") {
        out.push(p);
      }
    }
  }
  walk(rootDir, 0);
  return out;
}

/**
 * @param {string} rootDir
 * @param {{ maxDepth?: number }} [opts]
 */
export function loadSkillsFromDir(rootDir, opts = {}) {
  const files = findSkillFiles(rootDir, opts);
  /** @type {import('./parse-skill.mjs').parseSkillFile extends infer R ? R[] : never} */
  const skills = [];
  for (const file of files) {
    const r = parseSkillFile(file);
    if (r.ok) {
      skills.push(r);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
