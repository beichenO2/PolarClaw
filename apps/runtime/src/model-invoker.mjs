/**
 * @typedef {object} ModelClientConfig
 * @property {string} baseUrl Base URL without trailing slash (e.g. https://api.openai.com/v1)
 * @property {string} apiKey API key for Authorization header
 * @property {string} model Default model id
 */

/**
 * @typedef {object} ChatMessage
 * @property {"system"|"user"|"assistant"|"tool"} role
 * @property {string} [content]
 * @property {string} [name]
 * @property {string} [tool_call_id]
 * @property {object[]} [tool_calls]
 */

/**
 * @typedef {object} ChatOptions
 * @property {string} [model] Override default model
 * @property {number} [temperature]
 * @property {number} [max_tokens]
 * @property {object[]} [tools] OpenAI tools array
 * @property {"auto"|"none"|object} [tool_choice]
 * @property {AbortSignal} [signal]
 * @property {Record<string,string>} [headers] Extra request headers
 */

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new TypeError("createModelClient: baseUrl must be a non-empty string");
  }
  return baseUrl.replace(/\/+$/, "");
}

function buildUrl(baseUrl, path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${p}`;
}

async function parseErrorBody(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j?.error?.message ?? j?.message ?? text;
  } catch {
    return text || res.statusText;
  }
}

/**
 * Non-streaming chat completion (OpenAI-compatible).
 *
 * @param {string} url
 * @param {string} apiKey
 * @param {string} model
 * @param {ChatMessage[]} messages
 * @param {ChatOptions} [opts]
 */
async function postChat(url, apiKey, model, messages, opts = {}) {
  const body = {
    model: opts.model ?? model,
    messages,
    stream: false,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.tools !== undefined) body.tools = opts.tools;
  if (opts.tool_choice !== undefined) body.tool_choice = opts.tool_choice;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(opts.headers ?? {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await parseErrorBody(res);
    throw new Error(`Chat completion failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  if (!choice) {
    throw new Error("Chat completion: missing choices[0] in response");
  }
  return data;
}

/**
 * Streaming chat completion: yields parsed SSE JSON chunks (OpenAI format).
 *
 * @param {string} url
 * @param {string} apiKey
 * @param {string} model
 * @param {ChatMessage[]} messages
 * @param {ChatOptions} [opts]
 * @returns {AsyncGenerator<object, void, undefined>}
 */
async function* streamChat(url, apiKey, model, messages, opts = {}) {
  const body = {
    model: opts.model ?? model,
    messages,
    stream: true,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
  if (opts.tools !== undefined) body.tools = opts.tools;
  if (opts.tool_choice !== undefined) body.tool_choice = opts.tool_choice;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(opts.headers ?? {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await parseErrorBody(res);
    throw new Error(`Stream chat failed (${res.status}): ${detail}`);
  }

  if (!res.body) {
    throw new Error("Stream chat: response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") return;
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === "[DONE]") return;
        try {
          yield JSON.parse(jsonStr);
        } catch (e) {
          throw new Error(`Stream chat: invalid SSE JSON: ${jsonStr.slice(0, 200)}`);
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr && jsonStr !== "[DONE]") {
          yield JSON.parse(jsonStr);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * @param {ModelClientConfig} config
 */
export function createModelClient(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("createModelClient: config must be an object");
  }
  const { baseUrl, apiKey, model } = config;
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new TypeError("createModelClient: apiKey must be a non-empty string");
  }
  if (typeof model !== "string" || model === "") {
    throw new TypeError("createModelClient: model must be a non-empty string");
  }

  const chatUrl = buildUrl(baseUrl, "/chat/completions");

  return {
    /**
     * @param {ChatMessage[]} messages
     * @param {ChatOptions} [opts]
     */
    chat(messages, opts) {
      if (!Array.isArray(messages)) {
        throw new TypeError("chat(messages): messages must be an array");
      }
      return postChat(chatUrl, apiKey, model, messages, opts);
    },

    /**
     * @param {ChatMessage[]} messages
     * @param {ChatOptions} [opts]
     */
    stream(messages, opts) {
      if (!Array.isArray(messages)) {
        throw new TypeError("stream(messages): messages must be an array");
      }
      return streamChat(chatUrl, apiKey, model, messages, opts);
    },
  };
}
