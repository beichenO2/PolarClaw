/**
 * @param {ReturnType<import('./store.mjs').createMemoryStore>} store
 */
export function createFeedbackTracker(store) {
  if (!store?.database) {
    throw new TypeError("createFeedbackTracker: store must come from createMemoryStore");
  }
  const db = store.database;

  ensureFeedbackTable(db);

  const insertFeedback = db.prepare(`
    INSERT INTO feedback (user_id, message_id, rating, comment, created_at)
    VALUES (@userId, @messageId, @rating, @comment, @createdAt)
  `);

  const selectByUser = db.prepare(`
    SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `);

  const avgRating = db.prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as total FROM feedback WHERE user_id = ?
  `);

  const recentAvg = db.prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as total FROM feedback
    WHERE user_id = ? AND created_at >= ?
  `);

  const lowRated = db.prepare(`
    SELECT * FROM feedback WHERE user_id = ? AND rating <= 2 ORDER BY created_at DESC LIMIT ?
  `);

  function recordFeedback(userId, messageId, rating, comment = null) {
    if (!userId) throw new TypeError("userId is required");
    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      throw new TypeError("rating must be 1-5");
    }
    insertFeedback.run({
      userId: String(userId),
      messageId: messageId ? String(messageId) : null,
      rating,
      comment: comment ? String(comment) : null,
      createdAt: new Date().toISOString(),
    });

    const stats = avgRating.get(String(userId));
    store.saveProfile(String(userId), "feedback:avgRating", String(Math.round(stats.avg * 100) / 100));
    store.saveProfile(String(userId), "feedback:totalCount", String(stats.total));
  }

  function analyzeFeedbackTrends(userId, days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const recent = recentAvg.get(String(userId), since);
    const all = avgRating.get(String(userId));

    const trend = recent.avg && all.avg
      ? recent.avg > all.avg ? "improving" : recent.avg < all.avg ? "declining" : "stable"
      : "insufficient_data";

    return {
      recentAvg: recent.avg ? Math.round(recent.avg * 100) / 100 : null,
      recentCount: recent.total,
      overallAvg: all.avg ? Math.round(all.avg * 100) / 100 : null,
      overallCount: all.total,
      trend,
      period: `${days}d`,
    };
  }

  function suggestImprovements(userId, limit = 5) {
    const complaints = lowRated.all(String(userId), limit);
    if (complaints.length === 0) {
      return { suggestions: [], message: "No low-rated interactions found" };
    }
    return {
      suggestions: complaints.map((f) => ({
        messageId: f.message_id,
        rating: f.rating,
        comment: f.comment,
        date: f.created_at,
      })),
      message: `Found ${complaints.length} low-rated interactions to review`,
    };
  }

  function getHistory(userId, limit = 20) {
    return selectByUser.all(String(userId), limit);
  }

  return { recordFeedback, analyzeFeedbackTrends, suggestImprovements, getHistory };
}

function ensureFeedbackTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message_id TEXT,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT NOT NULL
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at)");
  } catch { /* index may already exist */ }
}
