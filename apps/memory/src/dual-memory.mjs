/**
 * Dual Memory Backend — bridges SQLite+FTS5 with MemPalace
 * Provides unified interface for storing/searching across both backends.
 *
 * Strategy:
 * - Write to both backends (SQLite for operational, MemPalace for semantic)
 * - Search: merge results from FTS5 (fast, exact) + MemPalace (semantic, contextual)
 * - SQLite is authoritative for recent interactions
 * - MemPalace is authoritative for long-term knowledge
 */

/**
 * @param {{
 *   sqliteStore: ReturnType<import('./store.mjs').createMemoryStore>,
 *   searchEngine: ReturnType<import('./search.mjs').createSearchEngine>,
 *   mempalace?: ReturnType<import('../../integrations/src/mempalace-adapter.mjs').createMemPalaceAdapter>
 * }} backends
 */
export function createDualMemory(backends) {
  const { sqliteStore, searchEngine, mempalace } = backends;
  const hasMemPalace = mempalace && mempalace.isInstalled() && mempalace.isInitialized();

  /**
   * Save a memory to both backends.
   * @param {{ content: string, type?: string, tags?: string, wing?: string }} params
   */
  async function save(params) {
    const { content, type = "note", tags, wing = "general" } = params;

    const sqlResult = sqliteStore.saveMemory({
      type,
      content,
      tags: tags ?? null,
      metadata: JSON.stringify({ source: "dual-memory", wing }),
    });

    let mpResult = null;
    if (hasMemPalace) {
      try {
        mpResult = await mempalace.store({
          content,
          wing,
          tags: tags ? tags.split(/[,\s]+/).filter(Boolean) : [],
        });
      } catch {
        mpResult = { ok: false, error: "mempalace store failed" };
      }
    }

    return {
      sqlite: { id: sqlResult.id, ok: true },
      mempalace: mpResult,
      backends: hasMemPalace ? 2 : 1,
    };
  }

  /**
   * Search across both backends and merge results.
   * @param {{ query: string, limit?: number, wing?: string }} params
   */
  async function search(params) {
    const { query, limit = 10, wing } = params;
    const results = [];

    try {
      const ftsResults = searchEngine.search(query, { limit: Math.ceil(limit * 0.6) });
      for (const row of ftsResults.rows ?? []) {
        results.push({
          id: row.id,
          content: row.content,
          type: row.type,
          source: "sqlite-fts5",
          score: row.rank ?? 0,
        });
      }
    } catch { /* FTS may fail on certain queries */ }

    if (hasMemPalace) {
      try {
        const mpResults = await mempalace.search({
          query,
          limit: Math.ceil(limit * 0.4),
          wing,
        });
        if (mpResults.ok && Array.isArray(mpResults.results)) {
          for (const item of mpResults.results) {
            results.push({
              id: item.id ?? `mp-${results.length}`,
              content: item.content ?? item.document ?? String(item),
              type: "mempalace",
              source: "mempalace",
              score: item.distance ?? item.score ?? 0,
            });
          }
        }
      } catch { /* MemPalace search may fail */ }
    }

    const seen = new Set();
    const deduped = results.filter((r) => {
      const key = r.content?.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      results: deduped.slice(0, limit),
      totalFromSqlite: results.filter((r) => r.source === "sqlite-fts5").length,
      totalFromMemPalace: results.filter((r) => r.source === "mempalace").length,
      backends: hasMemPalace ? 2 : 1,
    };
  }

  function getStatus() {
    return {
      sqliteReady: true,
      mempalaceReady: hasMemPalace,
      backends: hasMemPalace ? ["sqlite-fts5", "mempalace"] : ["sqlite-fts5"],
    };
  }

  return { save, search, getStatus };
}
