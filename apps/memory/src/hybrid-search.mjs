/**
 * Hybrid search: FTS5 keyword search + optional vector similarity, merged via
 * Reciprocal Rank Fusion (RRF).
 *
 * When no embedding function is provided, falls back to pure FTS5 search
 * (identical to createSearchEngine). This allows a smooth upgrade path:
 *
 *   1. Start with FTS5 only (current state — zero dependencies)
 *   2. Add sqlite-vec + embedding model later for semantic recall
 *
 * RRF reference: Cormack, Clarke & Buettcher (2009)
 *   score(d) = Σ 1 / (k + rank_i(d))   where k = 60 (standard)
 *
 * @see https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html
 * @see https://docs.bswen.com/blog/2026-03-17-fts5-vs-vector-search/
 */

const RRF_K = 60;

/**
 * @typedef {object} HybridSearchConfig
 * @property {ReturnType<import('./search.mjs').createSearchEngine>} ftsEngine
 * @property {((text: string) => Promise<Float32Array | number[]>) | null} [embed]
 *   Embedding function — if null, hybrid search degrades to pure FTS5.
 * @property {import('better-sqlite3').Database} [db]
 *   SQLite database with a vec0 virtual table (required when embed is set).
 * @property {string} [vectorTable] Name of the vec0 virtual table (default: "memory_vectors").
 * @property {number} [vectorDim] Embedding dimension (default: 384 for nomic-embed-text).
 * @property {number} [ftsWeight] Weight multiplier for FTS results in RRF (default: 1.0).
 * @property {number} [vecWeight] Weight multiplier for vector results in RRF (default: 1.0).
 */

/**
 * @param {HybridSearchConfig} config
 */
export function createHybridSearch(config) {
  const { ftsEngine, embed = null, db = null } = config;
  const vectorTable = config.vectorTable ?? "memory_vectors";
  const vectorDim = config.vectorDim ?? 384;
  const ftsWeight = config.ftsWeight ?? 1.0;
  const vecWeight = config.vecWeight ?? 1.0;

  const vectorEnabled = typeof embed === "function" && db != null;

  if (vectorEnabled) {
    ensureVectorTable(db, vectorTable, vectorDim);
  }

  /**
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   */
  async function search(query, opts = {}) {
    const limit = Math.min(Math.max(1, Number(opts.limit) || 50), 500);

    const ftsResult = safeSearch(ftsEngine, query, { limit: limit * 2 });
    const ftsRows = ftsResult?.rows ?? [];

    if (!vectorEnabled) {
      return {
        rows: ftsRows.slice(0, limit),
        total: ftsResult?.total ?? ftsRows.length,
        method: "fts5",
      };
    }

    const queryVec = await embed(query);
    const vecRows = searchByVector(db, vectorTable, queryVec, limit * 2);

    const merged = rrfMerge(ftsRows, vecRows, ftsWeight, vecWeight);
    return {
      rows: merged.slice(0, limit),
      total: Math.max(ftsResult?.total ?? 0, vecRows.length),
      method: "hybrid",
    };
  }

  /**
   * Store embedding for a memory row. Call after memory_save.
   * @param {number} memoryId
   * @param {string} content
   */
  async function indexVector(memoryId, content) {
    if (!vectorEnabled) return;
    const vec = await embed(content);
    upsertVector(db, vectorTable, memoryId, vec);
  }

  return {
    search,
    indexVector,
    get vectorEnabled() {
      return vectorEnabled;
    },
  };
}

/**
 * @param {ReturnType<import('./search.mjs').createSearchEngine>} engine
 * @param {string} query
 * @param {{ limit?: number }} opts
 */
function safeSearch(engine, query, opts) {
  try {
    return engine.search(query, opts);
  } catch {
    return { rows: [], total: 0 };
  }
}

/**
 * Reciprocal Rank Fusion: merge two ranked lists by row id.
 * @param {Array<{ id: number }>} listA
 * @param {Array<{ id: number }>} listB
 * @param {number} wA
 * @param {number} wB
 */
function rrfMerge(listA, listB, wA, wB) {
  /** @type {Map<number, { row: object, score: number }>} */
  const scores = new Map();

  for (let i = 0; i < listA.length; i++) {
    const row = listA[i];
    const s = wA / (RRF_K + i + 1);
    const prev = scores.get(row.id);
    scores.set(row.id, {
      row: prev?.row ?? row,
      score: (prev?.score ?? 0) + s,
    });
  }

  for (let i = 0; i < listB.length; i++) {
    const row = listB[i];
    const s = wB / (RRF_K + i + 1);
    const prev = scores.get(row.id);
    scores.set(row.id, {
      row: prev?.row ?? row,
      score: (prev?.score ?? 0) + s,
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((e) => e.row);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} dim
 */
function ensureVectorTable(db, table, dim) {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${table}
      USING vec0(memory_id INTEGER PRIMARY KEY, embedding float[${dim}])
    `);
  } catch {
    // sqlite-vec extension not loaded — vector search will be skipped
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {Float32Array | number[]} vec
 * @param {number} limit
 */
function searchByVector(db, table, vec, limit) {
  try {
    const buf =
      vec instanceof Float32Array ? vec : new Float32Array(vec);
    const rows = db
      .prepare(
        `SELECT memory_id AS id, distance
         FROM ${table}
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(buf.buffer, limit);
    return rows;
  } catch {
    return [];
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {number} memoryId
 * @param {Float32Array | number[]} vec
 */
function upsertVector(db, table, memoryId, vec) {
  try {
    const buf =
      vec instanceof Float32Array ? vec : new Float32Array(vec);
    db.prepare(
      `INSERT OR REPLACE INTO ${table} (memory_id, embedding) VALUES (?, ?)`,
    ).run(memoryId, buf.buffer);
  } catch {
    // sqlite-vec not available — silently skip
  }
}
