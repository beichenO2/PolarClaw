import { randomUUID } from "node:crypto";

/**
 * Well-known group categories.
 * Extend as needed; the DB column is free-form TEXT.
 */
export const GROUP_CATEGORIES = /** @type {const} */ ({
  DIGEST: "digest",
  DEBUG: "debug",
  ALERT: "alert",
  GENERAL: "general",
  STUDY: "study",
});

/**
 * @param {ReturnType<import('./db.mjs').openUserDb>} db
 */
export function createGroupRouter(db) {
  /**
   * Register or update a group's category.
   * @param {{ channel: string; externalChatId: string; category: string; label?: string }} opts
   */
  function registerGroup(opts) {
    return db.upsertGroup({
      id: randomUUID(),
      channel: opts.channel,
      externalChatId: opts.externalChatId,
      category: opts.category,
      label: opts.label,
    });
  }

  /**
   * Resolve which category a chat belongs to.
   * @param {string} channel
   * @param {string} externalChatId
   * @returns {string | null}
   */
  function resolveCategory(channel, externalChatId) {
    const g = db.getGroupByChat(channel, externalChatId);
    return g?.category ?? null;
  }

  /**
   * Get all group chat IDs for a given category (for targeted push).
   * @param {string} category
   * @returns {Array<{ channel: string; externalChatId: string; label: string | null }>}
   */
  function getTargets(category) {
    return db.getGroupsByCategory(category).map((g) => ({
      channel: g.channel,
      externalChatId: g.external_chat_id,
      label: g.label,
    }));
  }

  /**
   * List all registered groups.
   */
  function listAll() {
    return db.listGroups();
  }

  return {
    registerGroup,
    resolveCategory,
    getTargets,
    listAll,
  };
}
