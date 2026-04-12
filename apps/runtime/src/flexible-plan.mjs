/**
 * Lightweight plan tracker for non-rigid workflows: advance by step, record deviations without failing.
 */

/**
 * @param {string[]} steps
 */
export function createFlexiblePlanTracker(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError("createFlexiblePlanTracker(steps): steps must be a non-empty array");
  }
  const normalized = steps.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("createFlexiblePlanTracker: no non-empty steps");
  }

  let idx = 0;
  /** @type {{ at: string; note: string }[]} */
  const deviations = [];

  return {
    /** @readonly */
    steps: Object.freeze([...normalized]),

    get currentIndex() {
      return idx;
    },

    get currentStep() {
      return idx < normalized.length ? normalized[idx] : null;
    },

    get isComplete() {
      return idx >= normalized.length;
    },

    /**
     * Move to the next step (no-op if already complete).
     * @returns {string | null} Next step label, or null if done.
     */
    advance() {
      if (idx < normalized.length) {
        idx += 1;
      }
      return idx < normalized.length ? normalized[idx] : null;
    },

    /**
     * Record a deviation or reschedule reason (does not change current step).
     * @param {string} note
     */
    recordDeviation(note) {
      const n = String(note ?? "").trim();
      if (!n) return deviations.length;
      deviations.push({ at: new Date().toISOString(), note: n });
      return deviations.length;
    },

    listDeviations() {
      return deviations.map((d) => ({ ...d }));
    },
  };
}
