/**
 * Coding Plan overview page — the authoritative source for available models.
 */
export const DEFAULT_CODING_PLAN_DOC_URL =
  "https://help.aliyun.com/zh/model-studio/getting-started/models";

/** @deprecated Use DEFAULT_CODING_PLAN_DOC_URL instead. */
export const DEFAULT_BAILIAN_MODELS_DOC_URL = DEFAULT_CODING_PLAN_DOC_URL;

/**
 * Heuristic patterns for model IDs that appear in Coding Plan documentation.
 * Covers Qwen, Kimi, GLM, MiniMax, DeepSeek and common DashScope model families.
 * @param {string} html
 * @returns {string[]}
 */
export function extractModelIdsFromBailianDocs(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  /** @type {Set<string>} */
  const found = new Set();

  const patterns = [
    /\bqwen[a-z0-9][a-z0-9._-]*\b/gi,
    /\bkimi-[a-z0-9][a-z0-9._-]*\b/gi,
    /\bglm-[a-z0-9][a-z0-9._-]*\b/gi,
    /\bMiniMax-[A-Za-z0-9][A-Za-z0-9._-]*/g,
    /\bminimax-[a-z0-9][a-z0-9._-]*\b/gi,
    /\bdeepseek[a-z0-9][a-z0-9._-]*\b/gi,
    /\bllama[a-z0-9._-]*\b/gi,
    /\btext-embedding-[a-z0-9._-]*\b/gi,
    /\bmultimodal-embedding-[a-z0-9._-]*\b/gi,
  ];

  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      const id = normalizeModelId(m[0]);
      if (id && isPlausibleModelId(id)) found.add(id);
    }
  }

  return [...found].sort();
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeModelId(raw) {
  return raw.trim().replace(/[`'"<>]/g, "");
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function isPlausibleModelId(id) {
  if (id.length < 3 || id.length > 64) return false;
  if (id.includes("http") || id.includes("www.")) return false;
  return /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(id);
}

/**
 * Compare remote doc-derived model mentions with a local allowlist.
 *
 * @param {string[]} currentModels Known model IDs in your deployment/config
 * @param {{ docsUrl?: string, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ hasUpdates: boolean, newModels: string[], removedModels: string[], checkedUrl: string, checkedAt: string }>}
 */
export async function checkForModelUpdates(currentModels, options = {}) {
  const url = options.docsUrl ?? DEFAULT_CODING_PLAN_DOC_URL;
  const fetchFn =
    typeof options.fetchImpl === "function"
      ? options.fetchImpl
      : globalThis.fetch.bind(globalThis);

  const res = await fetchFn(url, {
    method: "GET",
    redirect: "follow",
    signal: options.signal,
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": "MyClaw-evolution/0.1.0 (+https://github.com/myclaw)",
    },
  });

  if (!res.ok) {
    throw new Error(`Coding Plan docs fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const remoteList = extractModelIdsFromBailianDocs(html);
  const remote = new Set(remoteList);
  const current = new Set(
    (currentModels ?? []).map((m) => normalizeModelId(String(m))).filter(Boolean),
  );

  const newModels = [...remote].filter((m) => !current.has(m)).sort();
  const removedModels = [...current].filter((m) => !remote.has(m)).sort();
  const hasUpdates = newModels.length > 0 || removedModels.length > 0;

  return {
    hasUpdates,
    newModels,
    removedModels,
    checkedUrl: url,
    checkedAt: new Date().toISOString(),
  };
}
