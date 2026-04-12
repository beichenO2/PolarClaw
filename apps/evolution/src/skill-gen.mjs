import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * @typedef {object} TraceStep
 * @property {string} [description]
 * @property {string} [action]
 * @property {string} [result]
 * @property {string} [tool]
 * @property {string} [timestamp]
 */

/**
 * @typedef {object} ExecutionTrace
 * @property {string} [taskSummary]
 * @property {string} [taskTitle]
 * @property {TraceStep[]} steps
 */

const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 1024;

/**
 * Lowercase slug: a-z, 0-9, single hyphens, no leading/trailing hyphen, no `--`.
 * @param {string} raw
 * @returns {string}
 */
export function slugifySkillName(raw) {
  let s = String(raw || "learned-skill")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!s) s = "learned-skill";
  if (s.startsWith("-")) s = s.slice(1);
  if (s.endsWith("-")) s = s.slice(0, -1);
  if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN).replace(/-+$/g, "");
  return s || "learned-skill";
}

/**
 * Build Agent Skills (agentskills.io) compliant YAML frontmatter + Markdown body from a trace.
 *
 * @param {ExecutionTrace} trace
 * @returns {string}
 */
export function generateSkill(trace) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const titleHint = trace?.taskTitle || trace?.taskSummary || "learned-task";
  const name = slugifySkillName(titleHint);

  let summary =
    typeof trace?.taskSummary === "string" && trace.taskSummary.trim()
      ? trace.taskSummary.trim()
      : steps
          .map((s) => s.description || s.action || "")
          .filter(Boolean)
          .slice(0, 3)
          .join(" ");

  if (!summary) {
    summary = `Reusable procedure distilled from ${steps.length} execution step(s).`;
  }
  if (summary.length > MAX_DESC_LEN) {
    summary = `${summary.slice(0, MAX_DESC_LEN - 3)}...`;
  }

  const generatedAt = new Date().toISOString();
  const traceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ name, steps }))
    .digest("hex")
    .slice(0, 12);

  const lines = [
    "---",
    `name: ${name}`,
    `description: ${yamlScalar(summary)}`,
    "license: Proprietary",
    "compatibility: Generated from execution traces; review before production use.",
    "metadata:",
    `  generated-at: "${generatedAt}"`,
    `  source: evolution-skill-gen`,
    `  trace-hash: "${traceHash}"`,
    "  step-count: " + String(steps.length),
    "---",
    "",
    "# Overview",
    "",
    trace?.taskSummary
      ? trace.taskSummary.trim()
      : "This skill was auto-generated from a completed complex task. Follow the steps below; adapt inputs to the user request.",
    "",
    "# Procedure",
    "",
  ];

  steps.forEach((step, i) => {
    const n = i + 1;
    const head =
      step.description?.trim() ||
      step.action?.trim() ||
      `Step ${n}`;
    lines.push(`## ${n}. ${head}`, "");
    if (step.tool?.trim()) {
      lines.push(`- **Tool**: \`${escapeMdInline(step.tool.trim())}\``);
    }
    if (step.action?.trim() && step.action.trim() !== head) {
      lines.push(`- **Action**: ${escapeMdInline(step.action.trim())}`);
    }
    if (step.result?.trim()) {
      lines.push("", "**Expected / observed outcome:**", "", "```text", step.result.trim(), "```", "");
    }
    if (step.timestamp?.trim()) {
      lines.push(`*Logged at: ${escapeMdInline(step.timestamp.trim())}*`, "");
    }
    lines.push("");
  });

  lines.push(
    "# Edge cases",
    "",
    "- If tools or APIs differ in your environment, substitute equivalents and re-verify.",
    "- Regenerate or edit this skill when the upstream workflow changes materially.",
    ""
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * @param {string} s
 * @returns {string}
 */
function yamlScalar(s) {
  const t = s.replace(/\r/g, "");
  if (/^[a-zA-Z0-9][a-zA-Z0-9 ./,:;_\-?()]*$/.test(t) && !t.includes("\n")) {
    return t;
  }
  const escaped = t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped.replace(/\n/g, "\\n")}"`;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeMdInline(s) {
  return s.replace(/`/g, "\\`");
}

/**
 * Write SKILL.md under `skillDir/name/SKILL.md` (directory name matches skill `name` per agentskills.io).
 *
 * @param {string} skillDir Parent directory containing skill folders
 * @param {string} name Skill folder name (must match frontmatter `name` inside `content`)
 * @param {string} content Full SKILL.md text
 * @returns {Promise<void>}
 */
export async function saveSkill(skillDir, name, content) {
  const folder = path.join(skillDir, name);
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, "SKILL.md");
  await fs.writeFile(file, content, "utf8");
}
