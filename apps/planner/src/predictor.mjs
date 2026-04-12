/**
 * @param {ReturnType<import('../../memory/src/store.mjs').createMemoryStore>} store
 * @param {ReturnType<import('../../memory/src/user-profile.mjs').createProfileManager>} profileManager
 */
export function createPredictor(store, profileManager) {
  if (!store?.database) throw new TypeError("createPredictor: store with .database required");
  if (!profileManager?.getProfile) throw new TypeError("createPredictor: profileManager required");

  const db = store.database;

  /**
   * Analyze user interaction patterns by hour-of-day and type.
   * @param {string} userId
   */
  function analyzePatterns(userId) {
    const profile = profileManager.getProfile(String(userId));
    const interactions = profile.interactions || [];

    const hourBuckets = new Array(24).fill(0);
    const typeCounts = {};
    const recentTopics = [];

    for (const ix of interactions) {
      if (ix.recordedAt) {
        const h = new Date(ix.recordedAt).getHours();
        hourBuckets[h]++;
      }
      const t = ix.type || "general";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      if (ix.topic) recentTopics.push(ix.topic);
    }

    const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return { userId, totalInteractions: interactions.length, peakHour, hourDistribution: hourBuckets, topTypes, recentTopics: [...new Set(recentTopics)].slice(0, 10) };
  }

  /**
   * Predict what the user might need next based on patterns.
   * @param {string} userId
   */
  function predictNextNeeds(userId) {
    const patterns = analyzePatterns(userId);
    const predictions = [];
    const now = new Date();
    const currentHour = now.getHours();

    if (patterns.totalInteractions < 5) {
      return { predictions: [{ type: "onboarding", confidence: 0.9, reason: "New user — suggest setup and preferences" }], patterns };
    }

    for (const { type, count } of patterns.topTypes) {
      if (count >= 3) {
        predictions.push({
          type,
          confidence: Math.min(0.9, 0.3 + (count / patterns.totalInteractions)),
          reason: `${type} is a frequent activity (${count}/${patterns.totalInteractions})`,
        });
      }
    }

    if (patterns.peakHour === currentHour || Math.abs(patterns.peakHour - currentHour) <= 1) {
      predictions.push({
        type: "peak_activity",
        confidence: 0.7,
        reason: `User is typically most active around ${patterns.peakHour}:00`,
      });
    }

    if (patterns.recentTopics.length > 0) {
      predictions.push({
        type: "continue_topic",
        confidence: 0.6,
        reason: `User was recently working on: ${patterns.recentTopics.slice(0, 3).join(", ")}`,
        topics: patterns.recentTopics.slice(0, 3),
      });
    }

    predictions.sort((a, b) => b.confidence - a.confidence);
    return { predictions: predictions.slice(0, 5), patterns };
  }

  /**
   * Generate proactive suggestions.
   * @param {string} userId
   */
  function generateProactiveSuggestions(userId) {
    const { predictions, patterns } = predictNextNeeds(userId);
    const suggestions = [];

    for (const pred of predictions) {
      switch (pred.type) {
        case "onboarding":
          suggestions.push({ action: "setup_preferences", message: "Let me help you set up your preferences for a better experience", priority: "high" });
          break;
        case "peak_activity":
          suggestions.push({ action: "daily_briefing", message: "This is your peak activity time — would you like a daily briefing?", priority: "medium" });
          break;
        case "continue_topic":
          suggestions.push({ action: "resume_work", message: `Want to continue with ${pred.topics?.[0] ?? "your recent work"}?`, priority: "medium", context: pred.topics });
          break;
        default:
          if (pred.confidence >= 0.5) {
            suggestions.push({ action: pred.type, message: `Based on your patterns, you might want to ${pred.type}`, priority: "low" });
          }
      }
    }

    return { suggestions, basedOn: { interactionCount: patterns.totalInteractions, topActivity: patterns.topTypes[0]?.type ?? "none" } };
  }

  return { analyzePatterns, predictNextNeeds, generateProactiveSuggestions };
}
