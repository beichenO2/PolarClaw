/**
 * Flexible supervision engine: schedule parsing, timed reminders,
 * alarm mode, and adaptive rescheduling.
 */

/**
 * @typedef {object} ScheduleEntry
 * @property {string} id
 * @property {string} userId
 * @property {string} type - 'class' | 'meal' | 'sleep' | 'study' | 'exam' | 'custom'
 * @property {string} title
 * @property {string} cronLike - "HH:MM" 24h format or day-of-week prefix "MO:08:00"
 * @property {number} [durationMin]
 * @property {boolean} [alarmMode] - repeat until acknowledged
 * @property {string} [note]
 */

/**
 * @typedef {object} ReminderState
 * @property {string} entryId
 * @property {string} userId
 * @property {boolean} acknowledged
 * @property {number} sentCount
 * @property {number} lastSentAt
 */

const DAY_MAP = /** @type {const} */ ({
  MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0,
});

const DEFAULT_MEAL_SCHEDULE = [
  { type: "meal", title: "早餐提醒", cronLike: "07:30", alarmMode: false },
  { type: "meal", title: "午餐提醒", cronLike: "11:45", alarmMode: false },
  { type: "meal", title: "晚餐提醒", cronLike: "17:45", alarmMode: false },
  { type: "sleep", title: "该准备睡觉了", cronLike: "22:30", alarmMode: true },
  { type: "sleep", title: "还在熬夜吗？快去睡觉！", cronLike: "23:30", alarmMode: true },
];

const ALARM_REPEAT_INTERVAL_MS = 5 * 60 * 1000;
const ALARM_MAX_REPEATS = 6;

/**
 * Parse "HH:MM" or "MO:HH:MM" format.
 * @param {string} cronLike
 * @returns {{ dayOfWeek: number | null; hour: number; minute: number } | null}
 */
function parseCronLike(cronLike) {
  const parts = cronLike.split(":");
  if (parts.length === 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { dayOfWeek: null, hour: h, minute: m };
    }
  } else if (parts.length === 3) {
    const dayKey = parts[0].toUpperCase();
    const dow = DAY_MAP[dayKey];
    if (dow === undefined) return null;
    const h = parseInt(parts[1], 10);
    const m = parseInt(parts[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { dayOfWeek: dow, hour: h, minute: m };
    }
  }
  return null;
}

/**
 * @typedef {object} SupervisionConfig
 * @property {string} [timeZone]
 * @property {(userId: string, message: string, entryId: string) => Promise<void>} sendReminder
 * @property {() => number} [now]
 */

/**
 * @param {SupervisionConfig} config
 */
export function createSupervisionEngine(config) {
  const timeZone = config.timeZone ?? "Asia/Shanghai";
  const sendReminder = config.sendReminder;
  const nowFn = config.now ?? (() => Date.now());

  /** @type {Map<string, ScheduleEntry[]>} userId → entries */
  const userSchedules = new Map();

  /** @type {Map<string, ReminderState>} entryId → state */
  const reminderStates = new Map();

  /** @type {ReturnType<typeof setInterval> | null} */
  let tickTimer = null;

  let counter = 0;
  function genId() {
    counter += 1;
    return `sched_${Date.now()}_${counter}`;
  }

  /**
   * Add default meal/sleep reminders for a user.
   * @param {string} userId
   */
  function addDefaultReminders(userId) {
    for (const d of DEFAULT_MEAL_SCHEDULE) {
      addEntry(userId, { ...d });
    }
  }

  /**
   * Add a schedule entry for a user.
   * @param {string} userId
   * @param {Omit<ScheduleEntry, 'id' | 'userId'>} entry
   * @returns {ScheduleEntry}
   */
  function addEntry(userId, entry) {
    const parsed = parseCronLike(entry.cronLike);
    if (!parsed) {
      throw new Error(`Invalid cronLike format: "${entry.cronLike}". Use "HH:MM" or "MO:HH:MM".`);
    }
    const full = /** @type {ScheduleEntry} */ ({
      ...entry,
      id: genId(),
      userId,
    });
    if (!userSchedules.has(userId)) {
      userSchedules.set(userId, []);
    }
    userSchedules.get(userId).push(full);
    return full;
  }

  /**
   * Remove a schedule entry.
   * @param {string} userId
   * @param {string} entryId
   */
  function removeEntry(userId, entryId) {
    const entries = userSchedules.get(userId);
    if (!entries) return false;
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    reminderStates.delete(entryId);
    return true;
  }

  /**
   * Get all schedule entries for a user.
   * @param {string} userId
   */
  function getSchedule(userId) {
    return userSchedules.get(userId) ?? [];
  }

  /**
   * Import parsed schedule from VLM (array of structured entries).
   * @param {string} userId
   * @param {Array<{ type?: string; title: string; cronLike: string; durationMin?: number; note?: string }>} parsed
   */
  function importSchedule(userId, parsed) {
    const results = [];
    for (const item of parsed) {
      try {
        const entry = addEntry(userId, {
          type: item.type ?? "class",
          title: item.title,
          cronLike: item.cronLike,
          durationMin: item.durationMin,
          note: item.note,
        });
        results.push({ ok: true, entry });
      } catch (err) {
        results.push({ ok: false, error: err.message, item });
      }
    }
    return results;
  }

  /**
   * Acknowledge a reminder (stops alarm mode repetition).
   * @param {string} entryId
   */
  function acknowledgeReminder(entryId) {
    const state = reminderStates.get(entryId);
    if (state) {
      state.acknowledged = true;
    }
  }

  /**
   * Reschedule: shift all entries of a user by deltaMinutes (flexible adjustment).
   * @param {string} userId
   * @param {number} deltaMinutes
   */
  function rescheduleAll(userId, deltaMinutes) {
    const entries = userSchedules.get(userId);
    if (!entries) return [];
    const updated = [];
    for (const e of entries) {
      const parsed = parseCronLike(e.cronLike);
      if (!parsed) continue;
      let totalMin = parsed.hour * 60 + parsed.minute + deltaMinutes;
      totalMin = ((totalMin % 1440) + 1440) % 1440;
      const newH = Math.floor(totalMin / 60);
      const newM = totalMin % 60;
      const hh = String(newH).padStart(2, "0");
      const mm = String(newM).padStart(2, "0");
      if (parsed.dayOfWeek !== null) {
        const dayKey = Object.entries(DAY_MAP).find(([, v]) => v === parsed.dayOfWeek)?.[0] ?? "MO";
        e.cronLike = `${dayKey}:${hh}:${mm}`;
      } else {
        e.cronLike = `${hh}:${mm}`;
      }
      updated.push(e);
    }
    return updated;
  }

  /**
   * Check which entries need firing now and send reminders.
   * Called by the tick loop.
   */
  async function tick() {
    const now = nowFn();
    const date = new Date(now);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const currentHour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const currentMinute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    });
    const currentDay = date.getDay();

    for (const [userId, entries] of userSchedules) {
      for (const entry of entries) {
        const parsed = parseCronLike(entry.cronLike);
        if (!parsed) continue;

        if (parsed.dayOfWeek !== null && parsed.dayOfWeek !== currentDay) continue;
        if (parsed.hour !== currentHour || parsed.minute !== currentMinute) {
          if (entry.alarmMode) {
            const state = reminderStates.get(entry.id);
            if (state && !state.acknowledged && state.sentCount < ALARM_MAX_REPEATS) {
              const elapsed = now - state.lastSentAt;
              if (elapsed >= ALARM_REPEAT_INTERVAL_MS) {
                state.sentCount += 1;
                state.lastSentAt = now;
                try {
                  await sendReminder(userId, `⏰ [重复提醒 #${state.sentCount}] ${entry.title}`, entry.id);
                } catch (e) {
                  console.error(`[@myclaw/proactive] alarm repeat failed for ${entry.id}:`, e);
                }
              }
            }
          }
          continue;
        }

        const state = reminderStates.get(entry.id);
        if (state && state.lastSentAt > now - 60_000) continue;

        const newState = {
          entryId: entry.id,
          userId,
          acknowledged: false,
          sentCount: 1,
          lastSentAt: now,
        };
        reminderStates.set(entry.id, newState);

        const icon = entry.type === "class" ? "📚"
          : entry.type === "meal" ? "🍽️"
          : entry.type === "sleep" ? "😴"
          : entry.type === "exam" ? "📝"
          : entry.type === "study" ? "📖"
          : "📌";
        const msg = `${icon} ${entry.title}${entry.note ? `\n${entry.note}` : ""}${entry.alarmMode ? "\n（闹铃模式：回复确认以停止提醒）" : ""}`;

        try {
          await sendReminder(userId, msg, entry.id);
        } catch (e) {
          console.error(`[@myclaw/proactive] reminder send failed for ${entry.id}:`, e);
        }
      }
    }
  }

  return {
    addDefaultReminders,
    addEntry,
    removeEntry,
    getSchedule,
    importSchedule,
    acknowledgeReminder,
    rescheduleAll,
    parseCronLike,

    start(intervalMs = 60_000) {
      if (tickTimer) return;
      tickTimer = setInterval(() => {
        tick().catch((e) => console.error("[@myclaw/proactive] supervision tick error:", e));
      }, intervalMs);
      tick().catch((e) => console.error("[@myclaw/proactive] supervision first tick error:", e));
    },

    stop() {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    },

    getStats() {
      let totalEntries = 0;
      for (const entries of userSchedules.values()) {
        totalEntries += entries.length;
      }
      return {
        users: userSchedules.size,
        totalEntries,
        activeAlarms: [...reminderStates.values()].filter((s) => !s.acknowledged).length,
      };
    },
  };
}
