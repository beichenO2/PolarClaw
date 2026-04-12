/**
 * Default model IDs for Alibaba Cloud Coding Plan (OpenAI-compatible).
 * Override per field via createRouter({ models: { ... } }).
 *
 * Coding Plan Base URL: https://coding.dashscope.aliyuncs.com/v1
 * API Key format: sk-sp-xxxxx (Coding Plan 专属)
 * Docs: https://help.aliyun.com/zh/model-studio/getting-started/models
 *
 * @type {Record<'coding' | 'research' | 'vision' | 'general', string>}
 */
export const MYCLAW_DEFAULT_MODEL_BY_INTENT = {
  coding: "qwen3-coder-plus",
  research: "qwen3.5-plus",
  vision: "qwen3.5-plus",
  general: "qwen3.5-plus",
};

/**
 * All models available under the Coding Plan subscription.
 * Auto-updated by @myclaw/evolution — see MODELS_DOC_URL.
 * Last verified: 2026-04-10
 */
export const CODING_PLAN_AVAILABLE_MODELS = [
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen3-max",
  "qwen3-max-2026-01-23",
  "qwen3-max-2025-09-23",
  "qwen3-max-preview",
  "qwen3-coder-plus",
  "qwen3-coder-plus-2025-09-23",
  "qwen3-coder-plus-2025-07-22",
  "qwen3-coder-flash",
  "qwen3-coder-flash-2025-07-28",
  "qwen3-vl-plus",
  "qwen3-vl-plus-2025-12-19",
  "qwen3-vl-plus-2025-09-23",
  "qwen3-vl-flash",
  "kimi-k2.5",
  "glm-5",
  "glm-4.7",
  "MiniMax-M2.5",
];

/**
 * Models that support multimodal (image/video) input.
 * qwen3.6-plus natively supports text + image + video.
 */
export const CODING_PLAN_VISION_MODELS = [
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen3-vl-plus",
  "qwen3-vl-flash",
  "kimi-k2.5",
];

/**
 * URL to check for model updates. Used by evolution module.
 */
export const MODELS_DOC_URL = "https://help.aliyun.com/zh/model-studio/getting-started/models";
