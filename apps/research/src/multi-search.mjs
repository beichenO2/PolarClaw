/**
 * Multi-source search manager — REQ-F02
 * Aggregates results from Wikipedia, arXiv, and custom sources.
 */

/**
 * @typedef {{ url?: string; title?: string; snippet: string; source?: string }} SearchHit
 */

/**
 * Create a Wikipedia search function for a given language.
 * @param {string} lang
 * @returns {(query: string) => Promise<SearchHit[]>}
 */
export function createWikipediaSearch(lang = "en") {
  return async (query) => {
    const q = String(query ?? "").trim();
    if (!q) return [];
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return [{ title: "Wikipedia", snippet: `HTTP ${res.status}`, source: "wikipedia" }];
      const data = await res.json();
      return (data?.query?.search ?? []).slice(0, 6).map((s) => ({
        title: s.title,
        snippet: String(s.snippet ?? "").replace(/<[^>]+>/g, ""),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
        source: "wikipedia",
      }));
    } catch (e) {
      return [{ title: "Wikipedia", snippet: `Error: ${e.message}`, source: "wikipedia" }];
    }
  };
}

/**
 * Create an arXiv search function — REQ-F03
 * @returns {(query: string) => Promise<SearchHit[]>}
 */
export function createArxivSearch() {
  return async (query) => {
    const q = String(query ?? "").trim();
    if (!q) return [];
    const apiUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=5&sortBy=relevance`;
    try {
      const res = await fetch(apiUrl, { headers: { Accept: "application/xml" } });
      if (!res.ok) return [];
      const xml = await res.text();

      const entries = [];
      const entryBlocks = xml.split("<entry>").slice(1);
      for (const block of entryBlocks) {
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
        const idMatch = block.match(/<id>([\s\S]*?)<\/id>/);

        if (titleMatch) {
          entries.push({
            title: titleMatch[1].trim().replace(/\s+/g, " "),
            snippet: (summaryMatch?.[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 300),
            url: idMatch?.[1]?.trim() ?? "",
            source: "arxiv",
          });
        }
      }
      return entries;
    } catch (e) {
      return [{ title: "arXiv", snippet: `Error: ${e.message}`, source: "arxiv" }];
    }
  };
}

/**
 * Create a multi-source search that queries all sources in parallel.
 * @param {{ sources?: Array<{ name: string, search: (q: string) => Promise<SearchHit[]> }> }} options
 */
export function createMultiSearch(options = {}) {
  const sources = options.sources ?? [
    { name: "wikipedia", search: createWikipediaSearch("en") },
    { name: "arxiv", search: createArxivSearch() },
  ];

  /**
   * Search across all sources, returning merged results.
   * @param {string} query
   * @param {{ maxPerSource?: number }} opts
   */
  async function search(query, opts = {}) {
    const maxPerSource = opts.maxPerSource ?? 5;
    const results = await Promise.allSettled(
      sources.map(async (src) => {
        const hits = await src.search(query);
        return hits.slice(0, maxPerSource).map((h) => ({
          ...h,
          source: h.source ?? src.name,
        }));
      })
    );

    const merged = [];
    for (const r of results) {
      if (r.status === "fulfilled") merged.push(...r.value);
    }
    return merged;
  }

  function listSources() {
    return sources.map((s) => s.name);
  }

  function addSource(name, searchFn) {
    sources.push({ name, search: searchFn });
  }

  return { search, listSources, addSource };
}
