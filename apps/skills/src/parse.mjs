/**
 * Parse AgentSkills / OpenClaw-style SKILL.md (YAML frontmatter + markdown body).
 * Supports simple `key: value` lines; multiline values are not expanded (v1).
 *
 * @param {string} raw
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseSkillMarkdown(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { frontmatter: {}, body: text.trimEnd() };
  }
  const rest = text.slice(3);
  const nl = rest.indexOf("\n");
  const firstLine = nl === -1 ? rest : rest.slice(0, nl);
  if (firstLine.trim() !== "") {
    return { frontmatter: {}, body: text.trimEnd() };
  }
  const afterFirstNl = nl === -1 ? "" : rest.slice(nl + 1);
  const close = afterFirstNl.indexOf("\n---");
  if (close === -1) {
    return { frontmatter: {}, body: text.trimEnd() };
  }
  const fmBlock = afterFirstNl.slice(0, close);
  const body = afterFirstNl.slice(close + 4).replace(/^\r?\n/, "");
  const frontmatter = parseSimpleYaml(fmBlock);
  return { frontmatter, body: body.trimEnd() };
}

/**
 * @param {string} block
 * @returns {Record<string, string>}
 */
function parseSimpleYaml(block) {
  /** @type {Record<string, string>} */
  const out = {};
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}
