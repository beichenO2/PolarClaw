import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * OpenClaw-style search roots (highest precedence first). See openclaw/docs/tools/skills.md
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot
 * @param {string[]} [opts.extraDirs] — lowest precedence among configured dirs
 * @returns {Promise<string[]>} existing directories only
 */
export async function resolveSkillSearchRoots({ workspaceRoot, extraDirs = [] }) {
  const home = os.homedir();
  const candidates = [
    path.join(workspaceRoot, "skills"),
    path.join(workspaceRoot, ".agents", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".openclaw", "skills"),
    ...extraDirs.map((d) => path.resolve(d)),
  ];
  const seen = new Set();
  const roots = [];
  for (const c of candidates) {
    const norm = path.normalize(c);
    if (seen.has(norm)) continue;
    seen.add(norm);
    try {
      const st = await fs.stat(norm);
      if (st.isDirectory()) roots.push(norm);
    } catch {
      /* missing */
    }
  }
  return roots;
}
