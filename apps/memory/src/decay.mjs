const DEFAULT_HALF_LIFE_DAYS = 30;
const DEFAULT_ACCESS_BOOST = 0.5;
const MIN_IMPORTANCE = 0.1;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ halfLifeDays?: number, accessBoost?: number }} [options]
 */
export function createDecayEngine(db, options = {}) {
  const halfLife = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const accessBoost = options.accessBoost ?? DEFAULT_ACCESS_BOOST;

  ensureDecayColumns(db);

  const updateImportance = db.prepare(`
    UPDATE memories SET importance = @importance, access_count = access_count + @accessDelta, updated_at = @now WHERE id = @id
  `);

  const selectAll = db.prepare(`
    SELECT id, importance, access_count, created_at, updated_at FROM memories WHERE importance > @minImportance
  `);

  const selectById = db.prepare(`
    SELECT id, importance, access_count, created_at, updated_at FROM memories WHERE id = ?
  `);

  function applyDecay() {
    const now = Date.now();
    const rows = selectAll.all({ minImportance: MIN_IMPORTANCE });
    let decayed = 0;

    const tx = db.transaction(() => {
      for (const row of rows) {
        const createdMs = new Date(row.created_at).getTime();
        const ageDays = (now - createdMs) / (1000 * 60 * 60 * 24);
        const decayFactor = Math.pow(0.5, ageDays / halfLife);
        const boosted = (row.access_count || 0) * accessBoost;
        const newImportance = Math.max(MIN_IMPORTANCE, (row.importance ?? 5) * decayFactor + boosted);

        if (Math.abs(newImportance - (row.importance ?? 5)) > 0.01) {
          updateImportance.run({ id: row.id, importance: Math.round(newImportance * 100) / 100, accessDelta: 0, now: new Date().toISOString() });
          decayed++;
        }
      }
    });

    tx();
    return { processed: rows.length, decayed };
  }

  function recordAccess(memoryId) {
    const row = selectById.get(memoryId);
    if (!row) throw new Error(`Memory ${memoryId} not found`);
    const newImportance = Math.min(10, (row.importance ?? 5) + accessBoost);
    updateImportance.run({ id: memoryId, importance: newImportance, accessDelta: 1, now: new Date().toISOString() });
  }

  function getLowImportance(threshold = 1.0, limit = 50) {
    return db.prepare(`
      SELECT id, type, content, importance, access_count, created_at
      FROM memories WHERE importance <= ? ORDER BY importance ASC LIMIT ?
    `).all(threshold, limit);
  }

  return { applyDecay, recordAccess, getLowImportance };
}

function ensureDecayColumns(db) {
  const cols = db.prepare("PRAGMA table_info(memories)").all().map((c) => c.name);
  if (!cols.includes("importance")) {
    db.exec("ALTER TABLE memories ADD COLUMN importance REAL DEFAULT 5.0");
  }
  if (!cols.includes("access_count")) {
    db.exec("ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0");
  }
  if (!cols.includes("category")) {
    db.exec("ALTER TABLE memories ADD COLUMN category TEXT DEFAULT 'note'");
  }
}
