import { createHash } from "node:crypto";

/**
 * Hash a bot token for storage (never store raw tokens in the user db).
 * @param {string} token
 */
export function hashBotToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * @param {ReturnType<import('./db.mjs').openUserDb>} db
 */
export function createUserManager(db) {
  /**
   * Bootstrap: ensure admin and girlfriend users exist.
   * Safe to call multiple times — idempotent via INSERT OR IGNORE semantics.
   * @param {{ adminName?: string; girlfriendName?: string; girlfriendPersona?: string }} opts
   */
  function bootstrap(opts = {}) {
    if (!db.getUser("admin")) {
      db.createUser({
        id: "admin",
        role: "admin",
        displayName: opts.adminName ?? "管理员",
      });
    }
    if (!db.getUser("girlfriend")) {
      db.createUser({
        id: "girlfriend",
        role: "girlfriend",
        displayName: opts.girlfriendName ?? "女友",
        personaStyle: opts.girlfriendPersona ?? "lively",
      });
    }
  }

  /**
   * Auto-bind: given a bot token and channel external ID, bind the external ID
   * to the user that owns this bot.
   * @param {{ botToken: string; channel: string; externalId: string }} opts
   */
  function autoBind(opts) {
    const hash = hashBotToken(opts.botToken);
    const existingUserId = db.resolveUserByBot(hash);
    if (existingUserId) {
      db.bindChannel({
        channel: opts.channel,
        externalId: opts.externalId,
        userId: existingUserId,
        botTokenHash: hash,
      });
      return existingUserId;
    }
    return null;
  }

  /**
   * Resolve inbound message to an internal user ID.
   *
   * Priority:
   *   1. Existing channel binding (channel + externalId)
   *   2. Bot token lookup → auto-bind
   *   3. null (unknown user)
   *
   * @param {{ channel: string; externalId: string; botToken?: string }} ctx
   * @returns {string | null}
   */
  function resolveIdentity(ctx) {
    const known = db.resolveUser(ctx.channel, ctx.externalId);
    if (known) return known;

    if (ctx.botToken) {
      return autoBind({
        botToken: ctx.botToken,
        channel: ctx.channel,
        externalId: ctx.externalId,
      });
    }
    return null;
  }

  /**
   * Register a bot token → user mapping.
   * Call once during config: "this telegram token serves the admin".
   * @param {{ botToken: string; userId: string; channel: string }} opts
   */
  function registerBotForUser(opts) {
    const hash = hashBotToken(opts.botToken);
    db.bindChannel({
      channel: opts.channel,
      externalId: `__bot__${hash}`,
      userId: opts.userId,
      botTokenHash: hash,
    });
  }

  /**
   * Get the user record with all channel bindings attached.
   * @param {string} userId
   */
  function getFullProfile(userId) {
    const user = db.getUser(userId);
    if (!user) return null;
    const bindings = db.listBindings(userId);
    return { ...user, bindings };
  }

  /**
   * Determine if a given user is the admin.
   * @param {string | null | undefined} userId
   */
  function isAdmin(userId) {
    if (!userId) return false;
    const user = db.getUser(userId);
    return user?.role === "admin";
  }

  /**
   * Determine if a given user is the girlfriend.
   * @param {string | null | undefined} userId
   */
  function isGirlfriend(userId) {
    if (!userId) return false;
    const user = db.getUser(userId);
    return user?.role === "girlfriend";
  }

  /**
   * Get the persona style string for a user (used by the prompt assembler).
   * @param {string | null | undefined} userId
   */
  function getPersonaStyle(userId) {
    if (!userId) return null;
    const user = db.getUser(userId);
    return user?.persona_style ?? null;
  }

  return {
    bootstrap,
    autoBind,
    resolveIdentity,
    registerBotForUser,
    getFullProfile,
    isAdmin,
    isGirlfriend,
    getPersonaStyle,
    hashBotToken,
    get db() {
      return db;
    },
  };
}
