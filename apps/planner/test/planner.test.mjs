import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPlanEngine } from "../src/plan-engine.mjs";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DB = join(tmpdir(), `planner-test-${Date.now()}.db`);

describe("PlanEngine", () => {
  let engine;

  beforeEach(() => {
    engine = createPlanEngine(TEST_DB);
  });

  afterEach(() => {
    engine.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  it("creates a plan with steps", () => {
    const { planId, stepsCreated } = engine.createPlan("Build security module", [
      "Create package.json",
      "Implement sandbox",
      "Write tests",
    ]);
    assert.ok(planId);
    assert.equal(stepsCreated, 3);

    const plan = engine.getPlan(planId);
    assert.equal(plan.goal, "Build security module");
    assert.equal(plan.steps.length, 3);
    assert.equal(plan.steps[0].status, "pending");
  });

  it("updates step status", () => {
    const { planId } = engine.createPlan("Test plan", ["Step 1", "Step 2"]);
    const plan = engine.getPlan(planId);
    const stepId = plan.steps[0].id;

    const result = engine.updateStep(planId, stepId, "done", "Completed successfully");
    assert.ok(result.updated);
    assert.equal(result.isDeviation, false);

    const updated = engine.getPlan(planId);
    assert.equal(updated.steps[0].status, "done");
  });

  it("tracks deviations correctly", () => {
    const { planId } = engine.createPlan("Deviation test", ["A", "B", "C", "D"]);
    const plan = engine.getPlan(planId);

    engine.updateStep(planId, plan.steps[0].id, "done");
    engine.updateStep(planId, plan.steps[1].id, "skipped", "Not needed");
    engine.updateStep(planId, plan.steps[2].id, "failed", "Dependency missing");

    const deviation = engine.detectDeviation(planId);
    assert.equal(deviation.done, 1);
    assert.equal(deviation.skipped, 1);
    assert.equal(deviation.failed, 1);
    assert.ok(deviation.deviationRate > 0.4);
    assert.equal(deviation.severity, "high");
    assert.ok(deviation.suggestions.length > 0);
  });

  it("replans remaining steps", () => {
    const { planId } = engine.createPlan("Replan test", ["A", "B", "C"]);
    const plan = engine.getPlan(planId);

    engine.updateStep(planId, plan.steps[0].id, "done");
    engine.updateStep(planId, plan.steps[1].id, "failed", "Error");

    const result = engine.replan(planId, "Retry failed steps");
    assert.equal(result.replanned, 2);

    const updated = engine.getPlan(planId);
    const failedStep = updated.steps.find((s) => s.id === plan.steps[1].id);
    assert.equal(failedStep.status, "pending");
  });

  it("lists plans by status", () => {
    engine.createPlan("Plan A", ["s1"]);
    engine.createPlan("Plan B", ["s1"]);

    const all = engine.listPlans();
    assert.equal(all.length, 2);

    const active = engine.listPlans("active");
    assert.equal(active.length, 2);
  });

  it("rejects invalid step status", () => {
    const { planId } = engine.createPlan("X", ["s"]);
    const plan = engine.getPlan(planId);
    assert.throws(() => engine.updateStep(planId, plan.steps[0].id, "invalid"), /Invalid status/);
  });
});
