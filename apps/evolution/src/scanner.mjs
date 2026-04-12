/**
 * @typedef {object} ScanHit
 * @property {string} title
 * @property {string} [url]
 * @property {string} [snippet]
 * @property {string} [source]
 */

/**
 * @typedef {object} ScanResult
 * @property {string} topic
 * @property {number} fetchedAt
 * @property {ScanHit[]} hits
 * @property {string} [provider]
 * @property {string} [rawNote]
 */

/**
 * @typedef {object} ScannerConfig
 * @property {'duckduckgo' | 'brave' | 'searxng' | 'custom'} [provider]
 * @property {string} [braveApiKey] Env: BRAVE_API_KEY if omitted
 * @property {string} [searxngUrl] Base URL, e.g. https://searx.example.org
 * @property {(topic: string) => Promise<Response> | Response} [fetchImpl] Override global fetch (tests)
 * @property {(topic: string) => { url: string, headers?: Record<string, string>, method?: string, body?: string }} [customRequest]
 * @property {(json: unknown, topic: string) => ScanHit[]} [customParse]
 * @property {string} [defaultTopic] Used by startAutoScan when scan() is called without argument
 */

/**
 * @param {ScannerConfig} config
 */
export function createScanner(config = {}) {
  /** @type {ScanResult | null} */
  let latest = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  const fetchFn =
    typeof config.fetchImpl === "function" ? config.fetchImpl : globalThis.fetch.bind(globalThis);

  /**
   * @param {string} [topic]
   * @returns {Promise<ScanResult>}
   */
  async function scan(topic) {
    const q = (topic ?? config.defaultTopic ?? "AI agent advances").trim();
    const provider = config.provider ?? "duckduckgo";

    /** @type {ScanResult} */
    let result = { topic: q, fetchedAt: Date.now(), hits: [], provider };

    if (provider === "custom" && config.customRequest && config.customParse) {
      const req = config.customRequest(q);
      const res = await fetchFn(req.url, {
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body,
      });
      if (!res.ok) {
        throw new Error(`Custom search failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json().catch(() => null);
      result.hits = config.customParse(data, q);
      latest = result;
      return result;
    }

    if (provider === "duckduckgo") {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=myclaw-evolution`;
      const res = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": "MyClaw-evolution/0.0.1" },
      });
      if (!res.ok) {
        throw new Error(`DuckDuckGo instant answer API failed: ${res.status}`);
      }
      /** @type {Record<string, unknown>} */
      const j = await res.json();
      result.hits = parseDuckDuckGoJson(j);
      if (typeof j.AbstractText === "string" && j.AbstractText.trim()) {
        result.rawNote = j.AbstractText.trim();
      }
      latest = result;
      return result;
    }

    if (provider === "brave") {
      const key = config.braveApiKey ?? process.env.BRAVE_API_KEY;
      if (!key) {
        throw new Error("Brave search requires braveApiKey or BRAVE_API_KEY");
      }
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
      const res = await fetchFn(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
          "User-Agent": "MyClaw-evolution/0.0.1",
        },
      });
      if (!res.ok) {
        throw new Error(`Brave search failed: ${res.status}`);
      }
      const j = await res.json();
      result.hits = parseBraveJson(j);
      latest = result;
      return result;
    }

    if (provider === "searxng") {
      const base = config.searxngUrl?.replace(/\/$/, "");
      if (!base) {
        throw new Error("searxng provider requires searxngUrl");
      }
      const url = `${base}/search?q=${encodeURIComponent(q)}&format=json`;
      const res = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": "MyClaw-evolution/0.0.1" },
      });
      if (!res.ok) {
        throw new Error(`SearXNG search failed: ${res.status}`);
      }
      const j = await res.json();
      result.hits = parseSearxngJson(j);
      latest = result;
      return result;
    }

    throw new Error(`Unknown scanner provider: ${provider}`);
  }

  function getLatest() {
    return latest;
  }

  /**
   * @param {number} intervalMs
   * @returns {() => void} stop
   */
  function startAutoScan(intervalMs) {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      scan().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  return { scan, getLatest, startAutoScan };
}

/**
 * @param {Record<string, unknown>} j
 * @returns {ScanHit[]}
 */
function parseDuckDuckGoJson(j) {
  /** @type {ScanHit[]} */
  const hits = [];
  if (typeof j.Heading === "string" && j.Heading.trim()) {
    hits.push({
      title: j.Heading.trim(),
      url: typeof j.AbstractURL === "string" ? j.AbstractURL : undefined,
      snippet: typeof j.AbstractText === "string" ? j.AbstractText : undefined,
      source: "duckduckgo-abstract",
    });
  }
  const related = j.RelatedTopics;
  if (Array.isArray(related)) {
    for (const item of related) {
      if (item && typeof item === "object" && "Text" in item) {
        const t = /** @type {{ Text?: string, FirstURL?: string }} */ (item);
        if (t.Text?.trim()) {
          hits.push({
            title: t.Text.trim().slice(0, 200),
            url: t.FirstURL,
            source: "duckduckgo-related",
          });
        }
      } else if (Array.isArray(item)) {
        for (const sub of item) {
          if (sub && typeof sub === "object" && "Text" in sub) {
            const t = /** @type {{ Text?: string, FirstURL?: string }} */ (sub);
            if (t.Text?.trim()) {
              hits.push({
                title: t.Text.trim().slice(0, 200),
                url: t.FirstURL,
                source: "duckduckgo-related",
              });
            }
          }
        }
      }
    }
  }
  return hits;
}

/**
 * @param {unknown} j
 * @returns {ScanHit[]}
 */
function parseBraveJson(j) {
  const web = j && typeof j === "object" && "web" in j ? /** @type {{ web?: { results?: unknown[] } }} */ (j).web : null;
  const results = web?.results;
  if (!Array.isArray(results)) return [];
  /** @type {ScanHit[]} */
  const hits = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (r);
    const title = typeof o.title === "string" ? o.title : "";
    const url = typeof o.url === "string" ? o.url : undefined;
    const snippet = typeof o.description === "string" ? o.description : undefined;
    if (title.trim()) hits.push({ title: title.trim(), url, snippet, source: "brave" });
  }
  return hits;
}

/**
 * @param {unknown} j
 * @returns {ScanHit[]}
 */
function parseSearxngJson(j) {
  const results = j && typeof j === "object" && "results" in j ? /** @type {{ results?: unknown[] }} */ (j).results : null;
  if (!Array.isArray(results)) return [];
  /** @type {ScanHit[]} */
  const hits = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (r);
    const title = typeof o.title === "string" ? o.title : "";
    const url = typeof o.url === "string" ? o.url : undefined;
    const snippet = typeof o.content === "string" ? o.content : undefined;
    if (title.trim()) hits.push({ title: title.trim(), url, snippet, source: "searxng" });
  }
  return hits;
}
