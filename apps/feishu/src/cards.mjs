/**
 * Feishu / Lark interactive message card builders (schema compatible with msg_type: interactive).
 */

/**
 * @param {object} task
 * @param {string} task.title
 * @param {string} [task.id]
 * @param {string} [task.status]
 * @param {string} [task.description]
 * @param {string} [task.link]
 * @param {number} [task.progress] 0–100
 */
export function buildTaskCard(task) {
  const title = typeof task.title === "string" ? task.title : "Task";
  const status = task.status != null ? String(task.status) : "unknown";
  const desc =
    task.description != null && String(task.description).trim()
      ? String(task.description).trim()
      : "—";
  const idLine = task.id != null ? `**ID:** ${String(task.id)}` : "";

  /** @type {Record<string, unknown>} */
  const elements = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: [idLine, `**状态:** ${status}`, "", desc].filter(Boolean).join("\n"),
      },
    },
  ];

  if (typeof task.progress === "number" && Number.isFinite(task.progress)) {
    const p = Math.min(100, Math.max(0, Math.round(task.progress)));
    elements.push({
      tag: "progress",
      percent: p,
    });
  }

  if (task.link && typeof task.link === "string" && task.link.trim()) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "打开链接" },
          type: "primary",
          url: task.link.trim(),
        },
      ],
    });
  }

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: "plain_text", content: `任务 · ${title.slice(0, 80)}` },
      template: "blue",
    },
    elements,
  };
}

/**
 * @param {object} report
 * @param {string} report.title
 * @param {string} [report.summary]
 * @param {Array<{ heading: string, body: string }>} [report.sections]
 * @param {string} [report.url]
 */
export function buildReportCard(report) {
  const title = typeof report.title === "string" ? report.title : "Research report";
  const summary =
    report.summary != null && String(report.summary).trim()
      ? String(report.summary).trim()
      : "";

  /** @type {Array<Record<string, unknown>>} */
  const elements = [];

  if (summary) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: summary.slice(0, 8000) },
    });
  }

  const sections = Array.isArray(report.sections) ? report.sections : [];
  for (const sec of sections.slice(0, 12)) {
    if (!sec || typeof sec !== "object") {
      continue;
    }
    const h = typeof sec.heading === "string" ? sec.heading : "Section";
    const b = typeof sec.body === "string" ? sec.body : "";
    if (!b.trim()) {
      continue;
    }
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${h}**\n${b.slice(0, 4000)}`,
      },
    });
  }

  if (elements.length === 0) {
    elements.push({
      tag: "div",
      text: { tag: "plain_text", content: "(No report body)" },
    });
  }

  if (report.url && typeof report.url === "string" && report.url.trim()) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "查看全文" },
          type: "default",
          url: report.url.trim(),
        },
      ],
    });
  }

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: "plain_text", content: title.slice(0, 80) },
      template: "wathet",
    },
    elements,
  };
}

/**
 * @param {object} suggestion
 * @param {string} suggestion.title
 * @param {string} [suggestion.body]
 * @param {Array<{ label: string, value: string }>} [suggestion.actions] value sent on card.action.trigger
 */
export function buildSuggestionCard(suggestion) {
  const title =
    typeof suggestion.title === "string" ? suggestion.title : "Suggestion";
  const body =
    suggestion.body != null && String(suggestion.body).trim()
      ? String(suggestion.body).trim()
      : "";

  /** @type {Array<Record<string, unknown>>} */
  const elements = [];
  if (body) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: body.slice(0, 8000) },
    });
  } else {
    elements.push({
      tag: "div",
      text: { tag: "plain_text", content: "You have a new proactive suggestion." },
    });
  }

  const actions = Array.isArray(suggestion.actions) ? suggestion.actions : [];
  const buttonActions = actions
    .filter((a) => a && typeof a.label === "string" && typeof a.value === "string")
    .slice(0, 5)
    .map((a) => ({
      tag: "button",
      text: { tag: "plain_text", content: a.label.slice(0, 40) },
      type: "primary",
      value: { action: "suggestion", payload: a.value.slice(0, 500) },
    }));

  if (buttonActions.length > 0) {
    elements.push({
      tag: "action",
      actions: buttonActions,
    });
  }

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: "plain_text", content: title.slice(0, 80) },
      template: "turquoise",
    },
    elements,
  };
}
