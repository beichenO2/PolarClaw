/**
 * Privacy mode controller: manages per-user privacy state,
 * local LLM routing, and PII sanitization pipeline.
 */

import { sanitizePii, sanitizeWithCustomEntities, desanitize, containsPii } from "./pii-detector.mjs";

const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";

/**
 * @typedef {object} PrivacyModeConfig
 * @property {string} [ollamaUrl] - Ollama API endpoint
 * @property {string} [ollamaModel] - Model name for local inference
 * @property {number} [healthCheckTimeoutMs] - Timeout for Ollama health check
 */

/**
 * @param {PrivacyModeConfig} [config]
 */
export function createPrivacyController(config = {}) {
  const ollamaUrl = (config.ollamaUrl ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
  const ollamaModel = config.ollamaModel ?? "qwen2.5:7b";
  const healthTimeout = config.healthCheckTimeoutMs ?? 3000;

  /** @type {Map<string, boolean>} userId → privacy mode on/off */
  const userPrivacyState = new Map();

  /** @type {Map<string, Map<string, string>>} userId → PII vault */
  const userVaults = new Map();

  /**
   * Check if Ollama (local LLM) is reachable.
   * @returns {Promise<boolean>}
   */
  async function isLocalLlmAvailable() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), healthTimeout);
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Call the local Ollama model for a chat completion.
   * @param {Array<{ role: string; content: string }>} messages
   * @returns {Promise<string>}
   */
  async function localChat(messages) {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.message?.content ?? "";
  }

  /**
   * Enter privacy mode for a user.
   * @param {string} userId
   * @returns {Promise<{ ok: boolean; error?: string }>}
   */
  async function enterPrivacyMode(userId) {
    const available = await isLocalLlmAvailable();
    if (!available) {
      return {
        ok: false,
        error: "本地 LLM (Ollama) 不可用，无法进入隐私模式。请确保 Ollama 已启动并正在运行。",
      };
    }
    userPrivacyState.set(userId, true);
    if (!userVaults.has(userId)) {
      userVaults.set(userId, new Map());
    }
    return { ok: true };
  }

  /**
   * Exit privacy mode for a user.
   * @param {string} userId
   */
  function exitPrivacyMode(userId) {
    userPrivacyState.set(userId, false);
  }

  /**
   * Check if a user is in privacy mode.
   * @param {string} userId
   * @returns {boolean}
   */
  function isInPrivacyMode(userId) {
    return userPrivacyState.get(userId) === true;
  }

  /**
   * Get or create the PII vault for a user.
   * @param {string} userId
   * @returns {Map<string, string>}
   */
  function getVault(userId) {
    if (!userVaults.has(userId)) {
      userVaults.set(userId, new Map());
    }
    return userVaults.get(userId);
  }

  /**
   * Sanitize user input: strip PII and replace with placeholders.
   * @param {string} userId
   * @param {string} text
   * @param {Array<{ value: string; type?: string }>} [customEntities]
   */
  function sanitizeInput(userId, text, customEntities) {
    const vault = getVault(userId);
    if (customEntities?.length) {
      return sanitizeWithCustomEntities(text, customEntities, vault);
    }
    return sanitizePii(text, vault);
  }

  /**
   * Desanitize output: replace placeholders back with real values.
   * @param {string} userId
   * @param {string} text
   */
  function desanitizeOutput(userId, text) {
    const vault = getVault(userId);
    return desanitize(text, vault);
  }

  /**
   * Sanitize chat history before sending to cloud API.
   * @param {string} userId
   * @param {Array<{ role: string; content: string }>} messages
   * @returns {Array<{ role: string; content: string }>}
   */
  function sanitizeHistory(userId, messages) {
    const vault = getVault(userId);
    return messages.map((m) => ({
      ...m,
      content: sanitizePii(m.content, vault).sanitized,
    }));
  }

  /**
   * Clear a user's PII vault (e.g., on session end or user request).
   * @param {string} userId
   */
  function clearVault(userId) {
    userVaults.delete(userId);
  }

  return {
    isLocalLlmAvailable,
    localChat,
    enterPrivacyMode,
    exitPrivacyMode,
    isInPrivacyMode,
    sanitizeInput,
    desanitizeOutput,
    sanitizeHistory,
    clearVault,
    containsPii,
    getVault,
  };
}
