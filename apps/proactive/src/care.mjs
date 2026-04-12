const DEFAULT_TZ = "UTC";

/**
 * @typedef {object} CareConfig
 * @property {(userId: string) => Promise<Record<string, unknown>>} [getUserMemory]
 * @property {() => number} [now]
 * @property {string} [timeZone]
 * @property {string} [locale]
 */

/**
 * @typedef {object} CareSuggestion
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {number} priority
 */

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
function asObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function asStringList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} memory
 * @returns {number | null}
 */
function lastActiveTs(memory) {
  const raw =
    memory.lastActiveAt ??
    memory.lastSeenAt ??
    memory.lastInteractionAt ??
    memory.updatedAt;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Heuristic keyword → suggestion templates (real rules, not random).
 * @type {Array<{ test: (t: string) => boolean; id: string; title: string; body: string; priority: number }>}
 */
const HELP_RULES = [
  {
    test: (t) => /\b(stuck|blocked|error|fail|broken)\b/i.test(t),
    id: "unblock",
    title: "排障与下一步",
    body: "你提到了受阻或错误。要不要把报错信息、期望结果和已尝试步骤列出来？我可以帮你拆成最小复现和修复顺序。",
    priority: 80,
  },
  {
    test: (t) => /\b(deadline|due|today|urgent|asap|赶)\b/i.test(t),
    id: "time_pressure",
    title: "时间压力",
    body: "听起来时间紧。建议先选唯一的最小可交付（MVP）目标，并把其余移入“稍后”清单，避免同时推进多条关键路径。",
    priority: 75,
  },
  {
    test: (t) => /\b(tired|burnout|exhaust|sleep|累|睡不着)\b/i.test(t),
    id: "rest",
    title: "节奏与恢复",
    body: "如果身体或注意力透支，短时恢复往往比硬扛更高效。要不要设定一个固定休息窗口，并把任务切成 25–45 分钟块？",
    priority: 85,
  },
  {
    test: (t) => /\b(learn|study|course|tutorial|文档)\b/i.test(t) || /学习|教程|课程/.test(t),
    id: "learning",
    title: "学习路径",
    body: "可以把目标改成“今天弄懂一个可运行例子”，然后围绕它补概念。需要的话我可以按你的基础给出最小阅读顺序。",
    priority: 55,
  },
  {
    test: (t) => t.length > 400 && !/\?|？/.test(t),
    id: "clarify",
    title: "澄清问题",
    body: "上下文很长但缺少明确问题。用一句话写出“我现在最想解决的一件事”，回复会更有针对性。",
    priority: 50,
  },
];

/**
 * @param {CareConfig} [config]
 */
export function createCareEngine(config = {}) {
  const getUserMemory =
    typeof config.getUserMemory === "function"
      ? config.getUserMemory
      : async () => ({});
  const nowFn = typeof config.now === "function" ? config.now : () => Date.now();
  const timeZone =
    typeof config.timeZone === "string" && config.timeZone.trim()
      ? config.timeZone.trim()
      : DEFAULT_TZ;
  const locale =
    typeof config.locale === "string" && config.locale.trim()
      ? config.locale.trim()
      : "zh-CN";

  /**
   * @param {string} userId
   */
  async function loadMemory(userId) {
    const raw = await getUserMemory(userId);
    return asObject(raw);
  }

  return {
    /**
     * Lightweight proactive ping: greeting + inferred absence / continuity.
     * @param {string} userId
     */
    async checkIn(userId) {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new TypeError("checkIn: userId must be a non-empty string");
      }
      const memory = await loadMemory(userId);
      const ts = lastActiveTs(memory);
      const now = nowFn();
      let tone = "steady";

      /** @type {string[]} */
      const notes = [];
      if (ts != null) {
        const gapMin = Math.round((now - ts) / 60_000);
        if (gapMin >= 24 * 60) {
          tone = "long_absence";
          notes.push(`距离上次活动约 ${Math.round(gapMin / 1440)} 天。`);
        } else if (gapMin >= 180) {
          tone = "medium_absence";
          notes.push(`距离上次活动约 ${gapMin} 分钟。`);
        } else {
          notes.push("最近仍有活动记录。");
        }
      } else {
        notes.push("暂无活动时间戳，我会按默认节奏关心你。");
      }

      const displayName =
        typeof memory.displayName === "string" && memory.displayName.trim()
          ? memory.displayName.trim()
          : userId;

      const hour = new Date(now).getHours();
      const part =
        hour < 11 ? "上午好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

      return {
        userId,
        greeting: `${part}，${displayName}。`,
        tone: tone.trim(),
        notes,
        suggestedFollowUps: [
          "今天最想完成的一件小事是什么？",
          "有没有任何卡住你超过 30 分钟的问题？",
        ],
        generatedAt: now,
      };
    },

    /**
     * Context-aware suggestions from memory + free-text context.
     * @param {string} userId
     * @param {string} context
     */
    async suggestHelp(userId, context) {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new TypeError("suggestHelp: userId must be a non-empty string");
      }
      const text = typeof context === "string" ? context : String(context ?? "");
      const memory = await loadMemory(userId);
      const goals = asStringList(memory.goals);
      const topics = asStringList(memory.topics ?? memory.interests);

      const haystack = [text, ...goals, ...topics].join("\n").slice(0, 8000);
      const matched = HELP_RULES.filter((r) => r.test(haystack)).sort(
        (a, b) => b.priority - a.priority,
      );

      /** @type {CareSuggestion[]} */
      const suggestions = matched.slice(0, 3).map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        priority: r.priority,
      }));

      if (goals.length > 0) {
        suggestions.push({
          id: "goal_anchor",
          title: "对齐目标",
          body: `你的记录里有关键目标：${goals.slice(0, 3).join("；")}。当前上下文是否在为其中之一服务？`,
          priority: 60,
        });
      }

      if (suggestions.length === 0) {
        suggestions.push({
          id: "default",
          title: "保持推进",
          body: "没有命中特定模式。试试把任务写成动词开头的下一步（5 分钟内能开始的那种）。",
          priority: 10,
        });
      }

      return {
        userId,
        contextPreview: text.slice(0, 280),
        suggestions: suggestions.sort((a, b) => b.priority - a.priority).slice(0, 5),
        generatedAt: nowFn(),
      };
    },

    /**
     * Daily-style digest from memory fields (no external APIs).
     * @param {string} userId
     */
    async generateDailyBrief(userId) {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new TypeError("generateDailyBrief: userId must be a non-empty string");
      }
      const memory = await loadMemory(userId);
      const goals = asStringList(memory.goals);
      const todos = asStringList(memory.todos ?? memory.tasks);
      const notes = asStringList(memory.notes ?? memory.recentNotes);
      const ts = lastActiveTs(memory);
      const now = nowFn();

      const dateLabel = new Intl.DateTimeFormat(locale, {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(now));

      /** @type {string[]} */
      const lines = [`# 每日简报 · ${dateLabel}`, ""];
      lines.push("## 焦点");
      if (goals.length > 0) {
        for (const g of goals.slice(0, 5)) {
          lines.push(`- ${g}`);
        }
      } else {
        lines.push("- （未记录长期目标）今天先选一个 30 分钟可验证的小目标。");
      }

      lines.push("", "## 待办快照");
      if (todos.length > 0) {
        for (const t of todos.slice(0, 7)) {
          lines.push(`- [ ] ${t}`);
        }
      } else {
        lines.push("- （无待办列表）写下 3 条，并按影响排序。");
      }

      lines.push("", "## 备忘");
      if (notes.length > 0) {
        for (const n of notes.slice(0, 5)) {
          lines.push(`- ${n}`);
        }
      } else {
        lines.push("- （无最近备忘）用一句话记录今天的一个关键决策或发现。");
      }

      lines.push("", "## 状态");
      if (ts != null) {
        const agoMin = Math.max(0, Math.round((now - ts) / 60_000));
        lines.push(`- 上次活动时间：约 ${agoMin} 分钟前`);
      } else {
        lines.push("- 上次活动时间：未知（可在 memory 中写入 lastActiveAt）");
      }

      const body = lines.join("\n");
      return {
        userId,
        markdown: body,
        meta: {
          goalCount: goals.length,
          todoCount: todos.length,
          noteCount: notes.length,
          lastActiveAt: ts,
        },
        generatedAt: now,
      };
    },
  };
}
