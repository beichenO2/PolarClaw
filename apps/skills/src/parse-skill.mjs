import { readFileSync } from "node:fs";

/**
 * Parse leading YAML frontmatter from SKILL.md (OpenClaw convention: --- ... ---).
 * Returns name, description, raw frontmatter map, and markdown body after the closing ---.
 *
 * @param {string} markdown
 * @returns {{ ok: true, name: string, description: string, frontmatter: Record<string, string>, body: string } | { ok: false, error: string }}
 */
export function parseSkillMarkdown(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { ok: false, error: "missing_frontmatter" };
  }
  const [, yamlBlock, body] = m;
  const frontmatter = parseSimpleYaml(yamlBlock);
  const name = frontmatter.name?.trim();
  const description = frontmatter.description?.trim() ?? "";
  if (!name) {
    return { ok: false, error: "missing_name" };
  }
  return {
    ok: true,
    name,
    description,
    frontmatter,
    body,
  };
}

/**
 * Minimal YAML subset: key: value per line, values can be quoted. Multi-line not supported.
 * @param {string} block
 * @returns {Record<string, string>}
 */
function parseSimpleYaml(block) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf(":");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {string} filePath
 */
export function parseSkillFile(filePath) {
  const markdown = readFileSync(filePath, "utf8");
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed.ok) {
    return parsed;
  }
  return { ...parsed, filePath };
}
