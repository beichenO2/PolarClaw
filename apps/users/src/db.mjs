import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('admin', 'girlfriend')),
  display_name TEXT,
  persona_style TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_bindings (
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  bot_token_hash TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_bindings_user ON channel_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_bindings_bot ON channel_bindings(bot_token_hash);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_chat_id TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(channel, external_chat_id)
);
`;

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {string} dbPath
 */
export function openUserDb(dbPath) {
  if (!dbPath || typeof dbPath !== "string") {
    throw new TypeError("openUserDb: dbPath must be a non-empty string");
  }
  const dir = dirname(dbPath);
  if (dir && dir !== ".") {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
    }
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const insertUser = db.prepare(`
    INSERT INTO users (id, role, display_name, persona_style, created_at, updated_at)
    VALUES (@id, @role, @display_name, @persona_style, @created_at, @updated_at)
  `);

  const updateUser = db.prepare(`
    UPDATE users SET display_name = @display_name, persona_style = @persona_style, updated_at = @updated_at
    WHERE id = @id
  `);

  const selectUser = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const selectAllUsers = db.prepare(`SELECT * FROM users ORDER BY created_at`);
  const selectUserByRole = db.prepare(`SELECT * FROM users WHERE role = ?`);

  const insertBinding = db.prepare(`
    INSERT INTO channel_bindings (channel, external_id, user_id, bot_token_hash, created_at)
    VALUES (@channel, @external_id, @user_id, @bot_token_hash, @created_at)
    ON CONFLICT(channel, external_id) DO UPDATE SET
      user_id = excluded.user_id,
      bot_token_hash = excluded.bot_token_hash
  `);

  const lookupBinding = db.prepare(`
    SELECT user_id FROM channel_bindings WHERE channel = ? AND external_id = ?
  `);

  const lookupByBot = db.prepare(`
    SELECT DISTINCT user_id FROM channel_bindings WHERE bot_token_hash = ? LIMIT 1
  `);

  const listBindings = db.prepare(`
    SELECT * FROM channel_bindings WHERE user_id = ? ORDER BY channel
  `);

  const insertGroup = db.prepare(`
    INSERT INTO groups (id, channel, external_chat_id, category, label, created_at)
    VALUES (@id, @channel, @external_chat_id, @category, @label, @created_at)
    ON CONFLICT(channel, external_chat_id) DO UPDATE SET
      category = excluded.category,
      label = excluded.label
  `);

  const selectGroupByChat = db.prepare(`
    SELECT * FROM groups WHERE channel = ? AND external_chat_id = ?
  `);

  const selectGroupsByCategory = db.prepare(`
    SELECT * FROM groups WHERE category = ? ORDER BY channel
  `);

  const selectAllGroups = db.prepare(`SELECT * FROM groups ORDER BY category, channel`);

  return {
    database: db,

    /**
     * @param {{ id: string; role: 'admin' | 'girlfriend'; displayName?: string; personaStyle?: string }} opts
     */
    createUser(opts) {
      const ts = nowIso();
      insertUser.run({
        id: opts.id,
        role: opts.role,
        display_name: opts.displayName ?? null,
        persona_style: opts.personaStyle ?? null,
        created_at: ts,
        updated_at: ts,
      });
      return selectUser.get(opts.id);
    },

    /**
     * @param {string} id
     * @param {{ displayName?: string; personaStyle?: string }} patch
     */
    updateUser(id, patch) {
      const existing = selectUser.get(id);
      if (!existing) throw new Error(`User not found: ${id}`);
      updateUser.run({
        id,
        display_name: patch.displayName ?? existing.display_name,
        persona_style: patch.personaStyle ?? existing.persona_style,
        updated_at: nowIso(),
      });
      return selectUser.get(id);
    },

    /** @param {string} id */
    getUser(id) {
      return selectUser.get(id) ?? null;
    },

    listUsers() {
      return selectAllUsers.all();
    },

    /** @param {'admin' | 'girlfriend'} role */
    getUserByRole(role) {
      return selectUserByRole.get(role) ?? null;
    },

    /**
     * @param {{ channel: string; externalId: string; userId: string; botTokenHash?: string }} opts
     */
    bindChannel(opts) {
      insertBinding.run({
        channel: opts.channel,
        external_id: opts.externalId,
        user_id: opts.userId,
        bot_token_hash: opts.botTokenHash ?? null,
        created_at: nowIso(),
      });
    },

    /**
     * @param {string} channel
     * @param {string} externalId
     */
    resolveUser(channel, externalId) {
      const row = lookupBinding.get(channel, externalId);
      return row?.user_id ?? null;
    },

    /** @param {string} botTokenHash */
    resolveUserByBot(botTokenHash) {
      const row = lookupByBot.get(botTokenHash);
      return row?.user_id ?? null;
    },

    /** @param {string} userId */
    listBindings(userId) {
      return listBindings.all(userId);
    },

    /**
     * @param {{ id: string; channel: string; externalChatId: string; category: string; label?: string }} opts
     */
    upsertGroup(opts) {
      insertGroup.run({
        id: opts.id,
        channel: opts.channel,
        external_chat_id: opts.externalChatId,
        category: opts.category,
        label: opts.label ?? null,
        created_at: nowIso(),
      });
      return selectGroupByChat.get(opts.channel, opts.externalChatId);
    },

    /**
     * @param {string} channel
     * @param {string} externalChatId
     */
    getGroupByChat(channel, externalChatId) {
      return selectGroupByChat.get(channel, externalChatId) ?? null;
    },

    /** @param {string} category */
    getGroupsByCategory(category) {
      return selectGroupsByCategory.all(category);
    },

    listGroups() {
      return selectAllGroups.all();
    },

    close() {
      db.close();
    },
  };
}
