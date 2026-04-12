/**
 * Escape a user query fragment for FTS5 prefix/column filters.
 * FTS5 special chars: we use parameter binding where possible; for MATCH we use quote wrapping.
 * @see https://www.sqlite.org/fts5.html
 */
function fts5QuoteToken(raw) {
  const s = String(raw).trim();
  if (!s) return "";
  // Double internal double-quotes
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Build an FTS5 query: tokenize on whitespace, OR tokens together.
 * Uses OR because the trigram tokenizer (needed for CJK) doesn't support AND.
 * @param {string} query
 */
function buildMatchQuery(query) {
  const parts = String(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(fts5QuoteToken)
    .filter((p) => p.length >= 5); // trigram needs 3+ chars; quoted adds 2
  if (parts.length === 0) return null;
  return parts.join(" OR ");
}

/**
 * @param {ReturnType<import('./store.mjs').createMemoryStore>} store
 */
export function createSearchEngine(store) {
  if (!store || typeof store !== "object" || !store.database) {
    throw new TypeError(
      "createSearchEngine(store): store must be returned from createMemoryStore (needs .database)"
    );
  }
  const db = store.database;

  const searchStmt = db.prepare(`
    SELECT m.id, m.type, m.content, m.metadata, m.tags, m.created_at, m.updated_at,
           bm25(memories_fts) AS rank
    FROM memories_fts
    JOIN memories m ON m.rowid = memories_fts.rowid
    WHERE memories_fts MATCH @match
    ORDER BY rank
    LIMIT @limit OFFSET @offset
  `);

  const searchCountStmt = db.prepare(`
    SELECT COUNT(*) AS c
    FROM memories_fts
    JOIN memories m ON m.rowid = memories_fts.rowid
    WHERE memories_fts MATCH @match
  `);

  const recentStmt = db.prepare(`
    SELECT id, type, content, metadata, tags, created_at, updated_at
    FROM memories
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const getMemoryRow = db.prepare(`
    SELECT id, type, content, metadata, tags, created_at, updated_at
    FROM memories WHERE id = ?
  `);

  /**
   * @param {string} query
   * @param {{ limit?: number, offset?: number }} [opts]
   */
  function search(query, opts = {}) {
    if (query == null || String(query).trim() === "") {
      throw new TypeError("search: query must be a non-empty string");
    }
    const limit =
      opts.limit != null ? Math.min(Math.max(0, Number(opts.limit)), 500) : 50;
    const offset = opts.offset != null ? Math.max(0, Number(opts.offset)) : 0;

    const match = buildMatchQuery(query);

    let rows = [];
    let total = 0;

    if (match) {
      try {
        rows = searchStmt.all({ match, limit, offset });
        total = /** @type {{ c: number }} */ (searchCountStmt.get({ match })).c;
      } catch {
        rows = [];
        total = 0;
      }
    }

    // Fallback to LIKE when FTS returned nothing (short CJK tokens, or trigram miss)
    if (rows.length === 0) {
      const rawTokens = String(query).trim().split(/\s+/).filter(Boolean);
      if (rawTokens.length > 0) {
        try {
          const likeClause = rawTokens.map(() => "(content LIKE ? OR tags LIKE ?)").join(" OR ");
          const likeParams = rawTokens.flatMap((t) => [`%${t}%`, `%${t}%`]);
          const fallbackRows = db
            .prepare(
              `SELECT id, type, content, metadata, tags, created_at, updated_at, 0 AS rank
               FROM memories WHERE ${likeClause}
               ORDER BY datetime(updated_at) DESC
               LIMIT ? OFFSET ?`
            )
            .all(...likeParams, limit, offset);
          rows = fallbackRows;
          total = fallbackRows.length;
        } catch {
          /* LIKE fallback failed */
        }
      }
    }

    if (rows.length === 0 && !match) {
      throw new TypeError("search: query has no searchable tokens");
    }

    return { rows, total, limit, offset };
  }

  /**
   * Heuristic "similar": BM25 search using first ~8 words of content plus tags.
   * @param {number} memoryId
   */
  function findSimilar(memoryId) {
    const id = Number(memoryId);
    if (!Number.isInteger(id) || id < 1) {
      throw new TypeError("findSimilar: memoryId must be a positive integer");
    }
    const row = getMemoryRow.get(id);
    if (!row) {
      throw new Error(`findSimilar: memory ${id} not found`);
    }
    const words = String(row.content || "")
      .trim()
      .split(/\s+/)
      .slice(0, 8)
      .filter(Boolean);
    const tagTokens = String(row.tags || "")
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const tokens = [...new Set([...words, ...tagTokens])];
    if (tokens.length === 0) {
      return { rows: [], total: 0, limit: 20, offset: 0 };
    }
    const syntheticQuery = tokens.join(" ");
    const { rows: allRows, total } = search(syntheticQuery, { limit: 30, offset: 0 });
    const rows = allRows.filter((r) => r.id !== id).slice(0, 20);
    return { rows, total: Math.max(0, total - 1), limit: 20, offset: 0 };
  }

  /**
   * @param {number} [limit]
   */
  function recentMemories(limit = 20) {
    const n = limit != null ? Math.min(Math.max(1, Number(limit)), 500) : 20;
    if (!Number.isFinite(n)) {
      throw new TypeError("recentMemories: limit must be a number");
    }
    return recentStmt.all(n);
  }

  return {
    search,
    findSimilar,
    recentMemories,
  };
}
