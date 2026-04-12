/**
 * Format optional per-turn system sections: memory retrieval + flexible plan state.
 * Profile keys (optional, set by tools or future apps/planner):
 * - lobster.flexPlan.goals — JSON array of strings or free text
 * - lobster.flexPlan.deviations — free text (delays, scope changes)
 */

/**
 * @param {{ userId: string, hits: Array<{ id?: unknown, content?: string }> }} p
 * @returns {string}
 */
export function formatMemoryContextBlock({ userId, hits }) {
  const uid = String(userId ?? "").trim() || "anonymous";
  const rows = Array.isArray(hits) ? hits : [];
  if (rows.length === 0) return "";
  const lines = rows.slice(0, 12).map((h) => {
    const id = h.id != null ? String(h.id) : "?";
    const c = String(h.content ?? "").replace(/\s+/g, " ").trim();
    const short = c.length > 420 ? `${c.slice(0, 420)}…` : c;
    return `- [memory #${id}] ${short}`;
  });
  return `# 相关长期记忆（本回合 FTS 检索）\n\n用户: ${uid}\n${lines.join("\n")}`;
}

/**
 * @param {{ goalsRaw?: string | null, deviationsRaw?: string | null }} p
 * @returns {string}
 */
export function formatFlexiblePlanContext({ goalsRaw, deviationsRaw }) {
  const goals = goalsRaw != null ? String(goalsRaw).trim() : "";
  const dev = deviationsRaw != null ? String(deviationsRaw).trim() : "";
  if (!goals && !dev) return "";

  const parts = [];
  if (goals) {
    try {
      const parsed = JSON.parse(goals);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parts.push(
          "## 当前目标\n" + parsed.map((g) => `- ${String(g)}`).join("\n"),
        );
      } else if (typeof parsed === "string" && parsed.trim()) {
        parts.push(`## 当前目标\n${parsed.trim()}`);
      } else {
        parts.push(`## 当前目标\n${goals}`);
      }
    } catch {
      parts.push(`## 当前目标\n${goals}`);
    }
  }
  if (dev) {
    parts.push(`## 计划偏差 / 调整记录\n${dev}`);
  }
  return `# 柔性规划上下文\n\n${parts.join("\n\n")}`;
}
