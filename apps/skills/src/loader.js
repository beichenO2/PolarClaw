import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "./frontmatter.js";

/** @typedef {{ name: string, description: string, skillKey: string, filePath: string, baseDir: string, source: string }} MyClawSkill */

const DEFAULT_MAX_BYTES = 512 * 1024;

function readSkillFile(filePath, maxBytes) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > maxBytes) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Load one skill directory (either root contains SKILL.md or is a parent of skill folders).
 * @param {{ skillDir: string, source: string, maxBytes?: number }} params
 * @returns {MyClawSkill | null}
 */
function loadSingleSkillDirectory(params) {
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES;
  const skillFilePath = path.join(params.skillDir, "SKILL.md");
  const raw = readSkillFile(skillFilePath, maxBytes);
  if (!raw) {
    return null;
  }

  const frontmatter = parseSkillFrontmatter(raw);
  const fallbackKey = path.basename(params.skillDir).trim();
  const name = (frontmatter.name ?? "").trim() || fallbackKey;
  const description = (frontmatter.description ?? "").trim();
  if (!name || !description) {
    return null;
  }

  const skillKey = (frontmatter.skillKey ?? frontmatter.name ?? "").trim() || fallbackKey;

  return {
    name,
    description,
    skillKey,
    filePath: path.resolve(skillFilePath),
    baseDir: path.resolve(params.skillDir),
    source: params.source,
  };
}

function listCandidateSkillDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
      )
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Scan a skills root directory using OpenClaw rules:
 * - If the root itself contains SKILL.md, return that single skill.
 * - Otherwise, one skill per immediate subdirectory containing SKILL.md.
 *
 * @param {{ dir: string, source: string, maxBytes?: number }} params
 * @returns {{ skills: MyClawSkill[] }}
 */
export function loadSkillsFromDir(params) {
  const rootDir = path.resolve(params.dir);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    return { skills: [] };
  }

  const rootSkill = loadSingleSkillDirectory({
    skillDir: rootDir,
    source: params.source,
    maxBytes: params.maxBytes,
  });
  if (rootSkill) {
    return { skills: [rootSkill] };
  }

  const skills = listCandidateSkillDirs(rootDir)
    .map((skillDir) =>
      loadSingleSkillDirectory({
        skillDir,
        source: params.source,
        maxBytes: params.maxBytes,
      }),
    )
    .filter((s) => s !== null);

  return { skills };
}
