/**
 * @typedef {object} JobRecord
 * @property {string} name
 * @property {number} intervalMs
 * @property {() => void | Promise<void>} handler
 * @property {ReturnType<typeof setTimeout> | null} timeoutId
 * @property {boolean} removed
 * @property {number | null} lastRunAt
 * @property {Error | null} lastError
 * @property {number} runCount
 */

/**
 * Cron-like scheduler using setTimeout chains (compensates handler duration to reduce drift).
 */
export function createScheduler() {
  /** @type {Map<string, JobRecord>} */
  const jobs = new Map();
  let started = false;

  /**
   * Run handler once, then schedule the next run after remaining interval budget.
   * @param {JobRecord} record
   */
  function runIteration(record) {
    if (!started || record.removed) return;
    const t0 = Date.now();
    const finish = () => {
      if (!started || record.removed) return;
      record.lastRunAt = Date.now();
      record.runCount += 1;
      const elapsed = Date.now() - t0;
      const wait = Math.max(0, record.intervalMs - elapsed);
      record.timeoutId = setTimeout(() => runIteration(record), wait);
    };

    try {
      const out = record.handler();
      if (out != null && typeof out.then === "function") {
        out.then(finish, (err) => {
          record.lastError = err instanceof Error ? err : new Error(String(err));
          finish();
        });
      } else {
        finish();
      }
    } catch (err) {
      record.lastError = err instanceof Error ? err : new Error(String(err));
      finish();
    }
  }

  /**
   * First execution waits `intervalMs`; subsequent ticks use runIteration.
   * @param {JobRecord} record
   */
  function arm(record) {
    if (!started || record.removed) return;
    record.timeoutId = setTimeout(() => runIteration(record), record.intervalMs);
  }

  return {
    /**
     * @param {string} name
     * @param {number} intervalMs
     * @param {() => void | Promise<void>} handler
     */
    addJob(name, intervalMs, handler) {
      if (typeof name !== "string" || !name.trim()) {
        throw new TypeError("addJob: name must be a non-empty string");
      }
      if (!Number.isFinite(intervalMs) || intervalMs < 1) {
        throw new TypeError("addJob: intervalMs must be a finite number >= 1");
      }
      if (typeof handler !== "function") {
        throw new TypeError("addJob: handler must be a function");
      }
      if (jobs.has(name)) {
        throw new Error(`addJob: job "${name}" already exists`);
      }

      /** @type {JobRecord} */
      const record = {
        name,
        intervalMs,
        handler,
        timeoutId: null,
        removed: false,
        lastRunAt: null,
        lastError: null,
        runCount: 0,
      };
      jobs.set(name, record);
      if (started) {
        arm(record);
      }
    },

    removeJob(name) {
      const record = jobs.get(name);
      if (!record) return false;
      record.removed = true;
      if (record.timeoutId != null) {
        clearTimeout(record.timeoutId);
        record.timeoutId = null;
      }
      jobs.delete(name);
      return true;
    },

    listJobs() {
      return [...jobs.values()].map((j) => ({
        name: j.name,
        intervalMs: j.intervalMs,
        lastRunAt: j.lastRunAt,
        lastError: j.lastError,
        runCount: j.runCount,
      }));
    },

    start() {
      if (started) return;
      started = true;
      for (const record of jobs.values()) {
        if (!record.removed) {
          arm(record);
        }
      }
    },

    stop() {
      if (!started) return;
      started = false;
      for (const record of jobs.values()) {
        if (record.timeoutId != null) {
          clearTimeout(record.timeoutId);
          record.timeoutId = null;
        }
      }
    },
  };
}
