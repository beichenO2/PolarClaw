const PREF_PREFIX = "pref:";
const INTERACTIONS_KEY = "__interactions_json";
const MAX_STORED_INTERACTIONS = 200;

/**
 * @param {ReturnType<import('./store.mjs').createMemoryStore>} store
 */
export function createProfileManager(store) {
  if (!store || typeof store.saveProfile !== "function" || typeof store.getProfile !== "function") {
    throw new TypeError(
      "createProfileManager(store): store must be returned from createMemoryStore"
    );
  }

  const listProfileKeysStmt = store.database.prepare(`
    SELECT key, value, updated_at FROM user_profiles WHERE user_id = ? ORDER BY key
  `);

  /**
   * @param {string} userId
   */
  function getProfile(userId) {
    if (userId == null) throw new TypeError("getProfile: userId is required");
    const uid = String(userId);
    const rows = listProfileKeysStmt.all(uid);
    const preferences = {};
    let interactions = [];
    for (const row of rows) {
      if (row.key.startsWith(PREF_PREFIX)) {
        const k = row.key.slice(PREF_PREFIX.length);
        preferences[k] = row.value;
      } else if (row.key === INTERACTIONS_KEY) {
        try {
          const parsed = JSON.parse(row.value || "[]");
          interactions = Array.isArray(parsed) ? parsed : [];
        } catch {
          interactions = [];
        }
      }
    }
    return {
      userId: uid,
      preferences,
      interactions,
      rawKeys: rows.map((r) => r.key),
    };
  }

  /**
   * @param {string} userId
   * @param {string} key
   * @param {string} value
   */
  function updatePreference(userId, key, value) {
    if (userId == null || key == null) {
      throw new TypeError("updatePreference: userId and key are required");
    }
    if (value === undefined) {
      throw new TypeError("updatePreference: value is required (use empty string to clear)");
    }
    const fullKey = PREF_PREFIX + String(key);
    store.saveProfile(String(userId), fullKey, String(value));
  }

  /**
   * @param {string} userId
   */
  function getPreferences(userId) {
    return { ...getProfile(userId).preferences };
  }

  /**
   * @param {string} userId
   * @param {Record<string, unknown>} interaction
   */
  function recordInteraction(userId, interaction) {
    if (userId == null) throw new TypeError("recordInteraction: userId is required");
    if (!interaction || typeof interaction !== "object") {
      throw new TypeError("recordInteraction: interaction must be an object");
    }
    const uid = String(userId);
    const profile = getProfile(uid);
    const entry = {
      ...interaction,
      recordedAt: new Date().toISOString(),
    };
    const next = [...profile.interactions, entry].slice(-MAX_STORED_INTERACTIONS);
    store.saveProfile(uid, INTERACTIONS_KEY, JSON.stringify(next));
  }

  return {
    getProfile,
    updatePreference,
    getPreferences,
    recordInteraction,
  };
}
