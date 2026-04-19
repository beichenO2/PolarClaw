/**
 * SQLite + FTS5 记忆存储适配器
 *
 * 实现 IMemoryStore 接口，复用旧 MyClaw 的 schema 设计。
 */

import Database from 'better-sqlite3';
import type { IMemoryStore } from '../../ports/memory.js';

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

-- FTS 同步触发器
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
`;

export function createSqliteMemoryStore(dbPath: string): IMemoryStore {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertMemory = db.prepare(`
    INSERT INTO memories (type, content, metadata, tags, created_at, updated_at)
    VALUES (@type, @content, @metadata, @tags, @createdAt, @updatedAt)
  `);

  const searchFts = db.prepare(`
    SELECT m.* FROM memories m
    JOIN memories_fts fts ON fts.rowid = m.id
    WHERE memories_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `);

  const countFts = db.prepare(`
    SELECT count(*) as total FROM memories_fts WHERE memories_fts MATCH @query
  `);

  const upsertProfile = db.prepare(`
    INSERT INTO user_profiles (user_id, key, value, updated_at)
    VALUES (@userId, @key, @value, @updatedAt)
    ON CONFLICT(user_id, key) DO UPDATE SET value = @value, updated_at = @updatedAt
  `);

  const getProfileStmt = db.prepare(`
    SELECT value FROM user_profiles WHERE user_id = @userId AND key = @key
  `);

  const getAllProfilesStmt = db.prepare(`
    SELECT user_id, key, value FROM user_profiles WHERE user_id = @userId
  `);

  return {
    save(entry) {
      const now = new Date().toISOString();
      const info = insertMemory.run({
        type: entry.type,
        content: entry.content,
        metadata: entry.metadata ?? null,
        tags: entry.tags ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return {
        id: Number(info.lastInsertRowid),
        type: entry.type,
        content: entry.content,
        tags: entry.tags,
        metadata: entry.metadata,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
    },

    search(query, options = {}) {
      const limit = options.limit ?? 10;
      let safeQuery = query.replace(/['"]/g, '');
      if (!safeQuery.trim()) return { entries: [], total: 0 };

      const isAscii = /^[\x00-\x7F]+$/.test(safeQuery);
      if (isAscii) {
        const tokens = safeQuery.trim().split(/\s+/).filter(Boolean);
        if (tokens.length > 1) {
          safeQuery = tokens.join(' AND ');
        }
      }

      try {
        const rows = searchFts.all({ query: safeQuery, limit }) as Array<{
          id: number; type: string; content: string; metadata: string | null;
          tags: string | null; created_at: string; updated_at: string;
        }>;
        const countRow = countFts.get({ query: safeQuery }) as { total: number } | undefined;

        return {
          entries: rows.map(r => ({
            id: r.id,
            type: r.type,
            content: r.content,
            tags: r.tags ?? undefined,
            metadata: r.metadata ?? undefined,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
          })),
          total: countRow?.total ?? rows.length,
        };
      } catch {
        return { entries: [], total: 0 };
      }
    },

    saveProfile(userId, key, value) {
      upsertProfile.run({
        userId,
        key,
        value: value ?? null,
        updatedAt: new Date().toISOString(),
      });
    },

    getProfile(userId, key) {
      const row = getProfileStmt.get({ userId, key }) as { value: string | null } | undefined;
      return row?.value ?? null;
    },

    getAllProfiles(userId) {
      const rows = getAllProfilesStmt.all({ userId }) as Array<{
        user_id: string; key: string; value: string | null;
      }>;
      return rows.map(r => ({
        userId: r.user_id,
        key: r.key,
        value: r.value,
      }));
    },

    close() {
      db.close();
    },
  };
}
