import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL DEFAULT '',
  metadata TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  content='memories',
  content_rowid='id',
  tokenize='trigram'
);
`;

const FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE(new.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.id, old.content, COALESCE(old.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.id, old.content, COALESCE(old.tags, ''));
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE(new.tags, ''));
END;
`;

function ensureParentDir(dbPath) {
  if (!dbPath || typeof dbPath !== "string") {
    throw new TypeError("createMemoryStore(dbPath): dbPath must be a non-empty string");
  }
  const dir = dirname(dbPath);
  if (dir && dir !== ".") {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} dbPath - Path to SQLite database file
 * @returns {{
 *   database: import('better-sqlite3').Database,
 *   saveMemory: (row: MemoryInput) => MemoryRow,
 *   getMemory: (id: number) => MemoryRow | undefined,
 *   deleteMemory: (id: number) => boolean,
 *   saveProfile: (userId: string, key: string, value: string | null) => void,
 *   getProfile: (userId: string, key: string) => string | null | undefined,
 *   listProfileEntries: (userId: string) => { key: string; value: string | null }[],
 *   close: () => void
 * }}
 */
export function createMemoryStore(dbPath) {
  ensureParentDir(dbPath);

  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    const e = new Error(`Failed to open database at ${dbPath}: ${err?.message ?? err}`);
    e.cause = err;
    throw e;
  }

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    db.exec(FTS_TRIGGERS);
  } catch (err) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    throw err;
  }

  const insertMemory = db.prepare(`
    INSERT INTO memories (type, content, metadata, tags, created_at, updated_at)
    VALUES (@type, @content, @metadata, @tags, @created_at, @updated_at)
  `);

  const updateMemory = db.prepare(`
    UPDATE memories SET
      type = @type,
      content = @content,
      metadata = @metadata,
      tags = @tags,
      updated_at = @updated_at
    WHERE id = @id
  `);

  const selectMemory = db.prepare(`
    SELECT id, type, content, metadata, tags, created_at, updated_at
    FROM memories WHERE id = ?
  `);

  const deleteMemoryStmt = db.prepare(`DELETE FROM memories WHERE id = ?`);

  const upsertProfile = db.prepare(`
    INSERT INTO user_profiles (user_id, key, value, updated_at)
    VALUES (@user_id, @key, @value, @updated_at)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const selectProfile = db.prepare(`
    SELECT value FROM user_profiles WHERE user_id = ? AND key = ?
  `);

  const selectAllProfilesForUser = db.prepare(`
    SELECT key, value FROM user_profiles WHERE user_id = ? ORDER BY key ASC
  `);

  /**
   * @typedef {object} MemoryInput
   * @property {number} [id]
   * @property {string} [type]
   * @property {string} [content]
   * @property {string | null} [metadata]
   * @property {string | null} [tags]
   */

  /**
   * @typedef {object} MemoryRow
   * @property {number} id
   * @property {string} type
   * @property {string} content
   * @property {string | null} metadata
   * @property {string | null} tags
   * @property {string} created_at
   * @property {string} updated_at
   */

  function saveMemory(input) {
    if (!input || typeof input !== "object") {
      throw new TypeError("saveMemory: expected an object");
    }
    const ts = nowIso();
    const type = input.type != null ? String(input.type) : "note";
    const content = input.content != null ? String(input.content) : "";
    const metadata =
      input.metadata === undefined || input.metadata === null
        ? null
        : String(input.metadata);
    const tags =
      input.tags === undefined || input.tags === null ? null : String(input.tags);

    if (input.id != null) {
      const id = Number(input.id);
      if (!Number.isInteger(id) || id < 1) {
        throw new TypeError("saveMemory: id must be a positive integer when provided");
      }
      const existing = selectMemory.get(id);
      if (!existing) {
        throw new Error(`saveMemory: no memory with id ${id}`);
      }
      const info = updateMemory.run({
        id,
        type,
        content,
        metadata,
        tags,
        updated_at: ts,
      });
      if (info.changes === 0) {
        throw new Error(`saveMemory: update failed for id ${id}`);
      }
      return /** @type {MemoryRow} */ (selectMemory.get(id));
    }

    const info = insertMemory.run({
      type,
      content,
      metadata,
      tags,
      created_at: ts,
      updated_at: ts,
    });
    const row = selectMemory.get(info.lastInsertRowid);
    if (!row) {
      throw new Error("saveMemory: failed to read inserted row");
    }
    return /** @type {MemoryRow} */ (row);
  }

  function getMemory(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) {
      throw new TypeError("getMemory: id must be a positive integer");
    }
    const row = selectMemory.get(n);
    return row ? /** @type {MemoryRow} */ (row) : undefined;
  }

  function deleteMemory(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) {
      throw new TypeError("deleteMemory: id must be a positive integer");
    }
    const info = deleteMemoryStmt.run(n);
    return info.changes > 0;
  }

  function saveProfile(userId, key, value) {
    if (userId == null || key == null) {
      throw new TypeError("saveProfile: userId and key are required");
    }
    const uid = String(userId);
    const k = String(key);
    const v = value === undefined || value === null ? null : String(value);
    upsertProfile.run({
      user_id: uid,
      key: k,
      value: v,
      updated_at: nowIso(),
    });
  }

  function getProfile(userId, key) {
    if (userId == null || key == null) {
      throw new TypeError("getProfile: userId and key are required");
    }
    const row = selectProfile.get(String(userId), String(key));
    if (!row) return undefined;
    return row.value;
  }

  /**
   * @param {string} userId
   * @returns {{ key: string; value: string | null }[]}
   */
  function listProfileEntries(userId) {
    if (userId == null) {
      throw new TypeError("listProfileEntries: userId is required");
    }
    const uid = String(userId);
    const rows = /** @type {{ key: string; value: string | null }[]} */ (
      selectAllProfilesForUser.all(uid)
    );
    return rows ?? [];
  }

  function close() {
    db.close();
  }

  return {
    database: db,
    saveMemory,
    getMemory,
    deleteMemory,
    saveProfile,
    getProfile,
    listProfileEntries,
    close,
  };
}
