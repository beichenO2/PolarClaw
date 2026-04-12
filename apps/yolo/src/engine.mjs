import { createRecovery } from "./recovery.mjs";

/**
 * @typedef {object} YoloStep
 * @property {string} id
 * @property {string} [name]
 * @property {(ctx: YoloContext) => unknown | Promise<unknown>} run
 */

/**
 * @typedef {object} YoloPlan
 * @property {string} id
 * @property {YoloStep[]} steps
 */

/**
 * @typedef {object} YoloContext
 * @property {string} planId
 * @property {YoloStep} step
 * @property {number} stepIndex
 * @property {number} attempt
 * @property {Record<string, unknown>} vars
 */

/**
 * @typedef {object} YoloEngineConfig
 * @property {ReturnType<typeof createRecovery>} [recovery]
 * @property {(ev: ProgressEvent) => void} [logger]
 */

/**
 * @typedef {object} ProgressEvent
 * @property {'step_start'|'step_success'|'step_error'|'step_retry'|'plan_complete'} type
 * @property {string} planId
 * @property {string} [stepId]
 * @property {number} [stepIndex]
 * @property {number} [attempt]
 * @property {unknown} [error]
 * @property {unknown} [result]
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {YoloEngineConfig} [config]
 */
export function createYoloEngine(config = {}) {
  const recovery = config.recovery ?? createRecovery();
  const logger = typeof config.logger === "function" ? config.logger : () => {};

  /** @type {Set<(ev: ProgressEvent) => void>} */
  const listeners = new Set();

  /** @type {{ running: boolean, planId: string | null, stepIndex: number, stepId: string | null, attempts: number, lastError: Error | null, completedSteps: number }} */
  const status = {
    running: false,
    planId: null,
    stepIndex: 0,
    stepId: null,
    attempts: 0,
    lastError: null,
    completedSteps: 0,
  };

  /**
   * @param {ProgressEvent} ev
   */
  function emit(ev) {
    logger(ev);
    for (const cb of listeners) {
      try {
        cb(ev);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  /**
   * @param {YoloPlan} plan
   */
  async function runPlan(plan) {
    if (!plan || typeof plan.id !== "string" || !plan.id.trim()) {
      throw new TypeError("execute: plan.id must be a non-empty string");
    }
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new TypeError("execute: plan.steps must be a non-empty array");
    }

    /** @type {Record<string, unknown>} */
    const vars = {};

    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (!step || typeof step.id !== "string" || !step.id.trim()) {
        throw new TypeError(`execute: steps[${i}].id must be a non-empty string`);
      }
      if (typeof step.run !== "function") {
        throw new TypeError(`execute: steps[${i}].run must be a function`);
      }

      let attempt = 0;
      for (;;) {
        status.stepIndex = i;
        status.stepId = step.id;
        status.attempts = attempt;

        /** @type {YoloContext} */
        const ctx = {
          planId: plan.id,
          step,
          stepIndex: i,
          attempt,
          vars,
        };

        emit({
          type: "step_start",
          planId: plan.id,
          stepId: step.id,
          stepIndex: i,
          attempt,
        });

        try {
          const result = await Promise.resolve(step.run(ctx));
          status.lastError = null;
          status.completedSteps += 1;
          vars[`lastResult:${step.id}`] = result;
          vars.lastResult = result;
          emit({
            type: "step_success",
            planId: plan.id,
            stepId: step.id,
            stepIndex: i,
            attempt,
            result,
          });
          break;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          status.lastError = err;

          emit({
            type: "step_error",
            planId: plan.id,
            stepId: step.id,
            stepIndex: i,
            attempt,
            error: err,
          });

          const fix = recovery.autoFix(err, {
            attempt,
            planId: plan.id,
            stepId: step.id,
          });

          if (recovery.isRecoverable(err) && fix.applied && fix.retryAfterMs > 0) {
            emit({
              type: "step_retry",
              planId: plan.id,
              stepId: step.id,
              stepIndex: i,
              attempt,
              error: err,
            });
            attempt += 1;
            await sleep(fix.retryAfterMs);
            continue;
          }

          if (recovery.isRecoverable(err)) {
            attempt += 1;
            const wait = Math.min(120_000, 1000 * 2 ** Math.min(attempt, 10));
            emit({
              type: "step_retry",
              planId: plan.id,
              stepId: step.id,
              stepIndex: i,
              attempt,
              error: err,
            });
            await sleep(wait);
            continue;
          }

          /* Non-recoverable: still never stop — escalate delay and keep trying same step */
          attempt += 1;
          const penalty = Math.min(300_000, 5000 + attempt * 1500);
          emit({
            type: "step_retry",
            planId: plan.id,
            stepId: step.id,
            stepIndex: i,
            attempt,
            error: err,
          });
          await sleep(penalty);
        }
      }
    }

    emit({ type: "plan_complete", planId: plan.id });
  }

  /** @type {Promise<void> | null} */
  let chain = Promise.resolve();

  return {
    /**
     * Queue plan execution. Serializes concurrent `execute` calls so one plan runs at a time.
     * Never resolves on failure: retries indefinitely until all steps succeed.
     * @param {YoloPlan} plan
     * @returns {Promise<void>}
     */
    execute(plan) {
      const p = chain.then(async () => {
        status.running = true;
        status.planId = plan?.id ?? null;
        status.completedSteps = 0;
        try {
          await runPlan(plan);
        } finally {
          status.running = false;
        }
      });
      chain = p.catch(() => {});
      return p;
    },

    getStatus() {
      return {
        running: status.running,
        planId: status.planId,
        stepIndex: status.stepIndex,
        stepId: status.stepId,
        attempts: status.attempts,
        lastError: status.lastError,
        completedSteps: status.completedSteps,
      };
    },

    /**
     * @param {(ev: ProgressEvent) => void} cb
     * @returns {() => void}
     */
    onProgress(cb) {
      if (typeof cb !== "function") {
        throw new TypeError("onProgress: cb must be a function");
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
