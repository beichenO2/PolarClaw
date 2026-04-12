const MAX_CONTEXT_TOKENS = 2000;
const AUTO_SAVE_KEYWORDS = ["remember", "note", "important", "preference", "prefer", "记住", "注意", "偏好", "重要"];

/**
 * @param {ReturnType<import('./store.mjs').createMemoryStore>} store
 * @param {ReturnType<import('./search.mjs').createSearchEngine>} searchEngine
 * @param {ReturnType<import('./user-profile.mjs').createProfileManager>} profileManager
 */
export function createContextBridge(store, searchEngine, profileManager) {
  if (!store || !searchEngine || !profileManager) {
    throw new TypeError("createContextBridge: all three arguments (store, searchEngine, profileManager) are required");
  }

  /**
   * Retrieve relevant context for a user message, ready to inject into system prompt.
   * @param {string} userId
   * @param {string} currentMessage
   * @returns {{ contextSnippet: string, memoriesUsed: number, profileKeys: string[] }}
   */
  function getRelevantContext(userId, currentMessage) {
    const parts = [];
    let memoriesUsed = 0;
    const profileKeys = [];

    const profile = profileManager.getProfile(String(userId));
    const prefEntries = Object.entries(profile.preferences);
    if (prefEntries.length > 0) {
      parts.push("## User Preferences");
      for (const [k, v] of prefEntries.slice(0, 10)) {
        parts.push(`- ${k}: ${v}`);
        profileKeys.push(k);
      }
    }

    if (currentMessage && currentMessage.trim()) {
      const keywords = extractKeywords(currentMessage);
      if (keywords) {
        try {
          const { rows } = searchEngine.search(keywords, { limit: 5 });
          if (rows.length > 0) {
            parts.push("## Relevant Memories");
            for (const row of rows) {
              const snippet = row.content.slice(0, 300);
              parts.push(`- [${row.type}] ${snippet}`);
              memoriesUsed++;
            }
          }
        } catch {
          /* search may fail on short queries */
        }
      }
    }

    try {
      const recent = searchEngine.recentMemories(3);
      if (recent.length > 0 && memoriesUsed === 0) {
        parts.push("## Recent Notes");
        for (const row of recent) {
          parts.push(`- ${row.content.slice(0, 200)}`);
          memoriesUsed++;
        }
      }
    } catch { /* empty db */ }

    const contextSnippet = parts.join("\n").slice(0, MAX_CONTEXT_TOKENS * 4);
    return { contextSnippet, memoriesUsed, profileKeys };
  }

  /**
   * After a response, auto-extract and save important information.
   * @param {string} userId
   * @param {Array<{role:string, content:string}>} messages
   * @param {string} response
   * @returns {{ saved: boolean, memoryId?: number }}
   */
  function afterResponse(userId, messages, response) {
    const lastUserMsg = messages?.filter((m) => m.role === "user").pop()?.content ?? "";

    const shouldSave = AUTO_SAVE_KEYWORDS.some((kw) =>
      lastUserMsg.toLowerCase().includes(kw)
    );

    if (!shouldSave) return { saved: false };

    const combined = `User: ${lastUserMsg.slice(0, 500)}\nAssistant: ${response.slice(0, 500)}`;
    const category = inferCategory(lastUserMsg);
    const memory = store.saveMemory({
      type: category,
      content: combined,
      tags: `auto-saved,${category}`,
      metadata: JSON.stringify({ userId, source: "context-bridge" }),
    });

    return { saved: true, memoryId: memory.id };
  }

  return { getRelevantContext, afterResponse };
}

function extractKeywords(text) {
  return text
    .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join(" ");
}

function inferCategory(text) {
  const lower = text.toLowerCase();
  if (/prefer|偏好|喜欢|不喜欢|习惯/.test(lower)) return "preference";
  if (/learn|经验|教训|发现/.test(lower)) return "experience";
  if (/how to|怎么|如何|方法/.test(lower)) return "skill";
  return "fact";
}
