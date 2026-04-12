import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const STEP_STATUSES = new Set(["pending", "in_progress", "done", "skipped", "deferred", "failed", "modified"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deviation_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  original_seq INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_plan ON plan_steps(plan_id, seq);

CREATE TABLE IF NOT EXISTS plan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  step_id TEXT,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

/**
 * @param {string} dbPath
 */
export function createPlanEngine(dbPath) {
  const dir = dirname(dbPath);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const insertPlan = db.prepare(`INSERT INTO plans (id, goal, status, created_at, updated_at, metadata) VALUES (@id, @goal, @status, @now, @now, @metadata)`);
  const insertStep = db.prepare(`INSERT INTO plan_steps (id, plan_id, seq, title, description, status, original_seq, created_at, updated_at) VALUES (@id, @planId, @seq, @title, @description, 'pending', @seq, @now, @now)`);
  const updateStepStmt = db.prepare(`UPDATE plan_steps SET status = @status, notes = @notes, updated_at = @now WHERE id = @id`);
  const selectPlan = db.prepare(`SELECT * FROM plans WHERE id = ?`);
  const selectSteps = db.prepare(`SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY seq ASC`);
  const insertEvent = db.prepare(`INSERT INTO plan_events (plan_id, step_id, event_type, detail, created_at) VALUES (@planId, @stepId, @type, @detail, @now)`);
  const bumpDeviation = db.prepare(`UPDATE plans SET deviation_count = deviation_count + 1, updated_at = @now WHERE id = @id`);
  const updatePlanStatus = db.prepare(`UPDATE plans SET status = @status, updated_at = @now WHERE id = @id`);
  const reorderStep = db.prepare(`UPDATE plan_steps SET seq = @seq, updated_at = @now WHERE id = @id`);

  function createPlan(goal, steps = [], metadata = null) {
    if (!goal) throw new TypeError("createPlan: goal is required");
    const now = new Date().toISOString();
    const planId = randomUUID().slice(0, 12);

    const tx = db.transaction(() => {
      insertPlan.run({ id: planId, goal, status: "active", now, metadata: metadata ? JSON.stringify(metadata) : null });
      for (let i = 0; i < steps.length; i++) {
        const s = typeof steps[i] === "string" ? { title: steps[i] } : steps[i];
        insertStep.run({
          id: randomUUID().slice(0, 12),
          planId,
          seq: i + 1,
          title: s.title,
          description: s.description ?? null,
          now,
        });
      }
    });
    tx();

    return { planId, stepsCreated: steps.length };
  }

  function updateStep(planId, stepId, status, notes = null) {
    if (!STEP_STATUSES.has(status)) throw new TypeError(`Invalid status: ${status}`);
    const now = new Date().toISOString();

    const step = db.prepare("SELECT * FROM plan_steps WHERE id = ? AND plan_id = ?").get(stepId, planId);
    if (!step) throw new Error(`Step ${stepId} not found in plan ${planId}`);

    const isDeviation = ["skipped", "deferred", "modified", "failed"].includes(status);

    const tx = db.transaction(() => {
      updateStepStmt.run({ id: stepId, status, notes, now });
      insertEvent.run({ planId, stepId, type: `step_${status}`, detail: notes, now });
      if (isDeviation) bumpDeviation.run({ id: planId, now });
    });
    tx();

    return { updated: true, isDeviation };
  }

  function detectDeviation(planId) {
    const plan = selectPlan.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const steps = selectSteps.all(planId);

    const total = steps.length;
    const done = steps.filter((s) => s.status === "done").length;
    const skipped = steps.filter((s) => s.status === "skipped").length;
    const deferred = steps.filter((s) => s.status === "deferred").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const pending = steps.filter((s) => s.status === "pending").length;

    const deviationRate = total > 0 ? (skipped + deferred + failed) / total : 0;
    const completionRate = total > 0 ? done / total : 0;

    const severity = deviationRate > 0.5 ? "high" : deviationRate > 0.2 ? "medium" : "low";

    const suggestions = [];
    if (failed > 0) suggestions.push(`${failed} step(s) failed — consider replanning`);
    if (deferred > 2) suggestions.push(`${deferred} deferred steps — reassess priorities`);
    if (deviationRate > 0.3 && pending > 0) suggestions.push("High deviation rate — recommend replan()");

    return { planId, total, done, skipped, deferred, failed, pending, deviationRate: Math.round(deviationRate * 100) / 100, completionRate: Math.round(completionRate * 100) / 100, severity, suggestions };
  }

  function replan(planId, reason) {
    const plan = selectPlan.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const steps = selectSteps.all(planId);
    const now = new Date().toISOString();

    const remaining = steps.filter((s) => ["pending", "deferred", "failed"].includes(s.status));

    const tx = db.transaction(() => {
      remaining.sort((a, b) => {
        const prio = { failed: 0, deferred: 1, pending: 2 };
        return (prio[a.status] ?? 9) - (prio[b.status] ?? 9);
      });

      const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
      for (let i = 0; i < remaining.length; i++) {
        reorderStep.run({ id: remaining[i].id, seq: doneCount + i + 1, now });
        if (remaining[i].status === "failed") {
          updateStepStmt.run({ id: remaining[i].id, status: "pending", notes: `Replanned: ${reason}`, now });
        }
      }
      insertEvent.run({ planId, stepId: null, type: "replan", detail: reason, now });
    });
    tx();

    return { replanned: remaining.length, reason };
  }

  function getPlan(planId) {
    const plan = selectPlan.get(planId);
    if (!plan) return null;
    const steps = selectSteps.all(planId);
    return { ...plan, steps };
  }

  function listPlans(status = null) {
    if (status) return db.prepare("SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC").all(status);
    return db.prepare("SELECT * FROM plans ORDER BY created_at DESC").all();
  }

  function completePlan(planId) {
    const now = new Date().toISOString();
    updatePlanStatus.run({ id: planId, status: "completed", now });
    insertEvent.run({ planId, stepId: null, type: "plan_completed", detail: null, now });
  }

  function close() { db.close(); }

  return { createPlan, updateStep, detectDeviation, replan, getPlan, listPlans, completePlan, close };
}
