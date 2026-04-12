/**
 * Intent-based model routing for MyClaw (REQ-012).
 */

import { MYCLAW_DEFAULT_MODEL_BY_INTENT } from "./models.mjs";

/**
 * @typedef {'coding' | 'research' | 'vision' | 'general'} RouteIntent
 */

const VISION_HINTS =
  /\b(vision|multimodal|image|screenshot|png|jpe?g|gif|webp|picture|photo)\b|图片|截图|图像|视觉/i;
const CODING_HINTS =
  /\b(code|refactor|debug|implement|function|class|typescript|javascript|python|rust|go\b|pr\b|commit|lint|test\b|api\b|bug)\b|重构|实现|调试|代码|函数|类|提交/i;
const RESEARCH_HINTS =
  /\b(research|paper|summarize|analyze|compare|literature|arxiv)\b|论文|研究|综述|分析|对比|文献/i;

/**
 * @param {unknown} part
 * @returns {boolean}
 */
function partIsImage(part) {
  if (part == null || typeof part !== "object") return false;
  const p = /** @type {{ type?: string }} */ (part);
  const t = p.type;
  return t === "image_url" || t === "image" || t === "input_image";
}

/**
 * @param {unknown} part
 * @returns {string}
 */
function partToText(part) {
  if (part == null) return "";
  if (typeof part === "string") return part;
  if (typeof part === "object" && "text" in part && typeof part.text === "string") {
    return part.text;
  }
  if (partIsImage(part)) return " ";
  return "";
}

/**
 * @param {unknown} msg
 * @returns {string}
 */
function messageToText(msg) {
  if (msg == null || typeof msg !== "object") return "";
  const m = /** @type {{ content?: unknown; role?: string }} */ (msg);
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(partToText).join("\n");
  return "";
}

/**
 * @param {unknown} msg
 * @returns {boolean}
 */
function messageHasImagePart(msg) {
  if (msg == null || typeof msg !== "object") return false;
  const c = /** @type {{ content?: unknown }} */ (msg).content;
  if (!Array.isArray(c)) return false;
  return c.some(partIsImage);
}

/**
 * Infer routing intent from one user/assistant message or concatenated text.
 * Priority: vision > coding > research > general.
 *
 * @param {string} text
 * @returns {RouteIntent}
 */
export function inferIntentFromText(text) {
  const s = text || "";
  if (VISION_HINTS.test(s)) return "vision";
  if (CODING_HINTS.test(s)) return "coding";
  if (RESEARCH_HINTS.test(s)) return "research";
  return "general";
}

/**
 * @param {Array<{ role?: string; content?: unknown }>} messages
 * @param {{ lastUserOnly?: boolean }} [opts]
 * @returns {RouteIntent}
 */
export function inferIntentFromMessages(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUserOnly = opts.lastUserOnly !== false;
  if (lastUserOnly) {
    for (let i = list.length - 1; i >= 0; i--) {
      const msg = list[i];
      if (msg && msg.role === "user") {
        if (messageHasImagePart(msg)) return "vision";
        return inferIntentFromText(messageToText(msg));
      }
    }
  }
  const combined = list.map((m) => messageToText(m)).join("\n");
  return inferIntentFromText(combined);
}

/**
 * @param {RouteIntent} intent
 * @param {Partial<Record<RouteIntent, string>>} [overrides]
 * @returns {string}
 */
export function selectModelForIntent(intent, overrides = {}) {
  const base = { ...MYCLAW_DEFAULT_MODEL_BY_INTENT, ...overrides };
  const key = base[intent] ? intent : "general";
  return base[key] ?? base.general;
}

/**
 * @param {{ models?: Partial<Record<RouteIntent, string>> }} [config]
 */
export function createRouter(config = {}) {
  const models = { ...MYCLAW_DEFAULT_MODEL_BY_INTENT, ...config.models };

  return {
    models,
    /**
     * @param {RouteIntent} intent
     */
    modelForIntent(intent) {
      return selectModelForIntent(intent, models);
    },
    /**
     * @param {string} text
     */
    intentFromText(text) {
      return inferIntentFromText(text);
    },
    /**
     * @param {Array<{ role?: string; content?: unknown }>} messages
     * @param {{ lastUserOnly?: boolean }} [o]
     */
    intentFromMessages(messages, o) {
      return inferIntentFromMessages(messages, o);
    },
    /**
     * @param {Array<{ role?: string; content?: unknown }>} messages
     * @param {{ lastUserOnly?: boolean }} [o]
     */
    resolveModelForMessages(messages, o) {
      const intent = inferIntentFromMessages(messages, o);
      return { intent, model: selectModelForIntent(intent, models) };
    },
  };
}
