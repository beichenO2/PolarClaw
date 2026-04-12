import YAML from "yaml";

/**
 * Extract YAML frontmatter between first pair of --- lines (OpenClaw / agentskills.io style).
 * Values are normalized to strings for stable downstream use.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseSkillFrontmatter(content) {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return {};
  }
  const rest = trimmed.slice(3);
  const end = rest.indexOf("\n---");
  if (end === -1) {
    return {};
  }
  const block = rest.slice(0, end).replace(/^\r?\n/, "");
  try {
    const parsed = YAML.parse(block, { schema: "core" });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
      const key = String(k).trim();
      if (!key) continue;
      if (v === null || v === undefined) continue;
      if (typeof v === "object") {
        out[key] = JSON.stringify(v);
      } else {
        out[key] = String(v).trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}
