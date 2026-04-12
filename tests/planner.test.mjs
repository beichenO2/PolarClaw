import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createPlanEngine } from "../apps/planner/src/plan-engine.mjs";

describe("PlanEngine", () => {
  let engine, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "myclaw-test-"));
    engine = createPlanEngine(join(tmpDir, "plans.db"));
  });

  after(() => {
    engine.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a plan with steps", () => {
    const result = engine.createPlan("Build security module", [
      "Design API surface",
      "Implement sandbox",
      { title: "Write tests", description: "Unit + integration" },
    ]);
    assert.ok(result.planId);
    assert.equal(result.stepsCreated, 3);
  });

  it("retrieves a plan with steps", () => {
    const plans = engine.listPlans();
    assert.ok(plans.length >= 1);
    const plan = engine.getPlan(plans[0].id);
    assert.ok(plan);
    assert.equal(plan.goal, "Build security module");
    assert.ok(plan.steps.length >= 3);
    assert.equal(plan.steps[0].status, "pending");
  });

  it("updates step status", () => {
    const plan = engine.listPlans()[0];
    const fullPlan = engine.getPlan(plan.id);
    const step = fullPlan.steps[0];
    const result = engine.updateStep(plan.id, step.id, "done", "Completed successfully");
    assert.ok(result.updated);
    assert.equal(result.isDeviation, false);
  });

  it("tracks deviations when steps are skipped/failed", () => {
    const plan = engine.listPlans()[0];
    const fullPlan = engine.getPlan(plan.id);
    const step2 = fullPlan.steps[1];
    engine.updateStep(plan.id, step2.id, "failed", "Build error");

    const deviation = engine.detectDeviation(plan.id);
    assert.ok(deviation.failed >= 1);
    assert.ok(deviation.deviationRate > 0);
  });

  it("replans failed steps", () => {
    const plan = engine.listPlans()[0];
    const result = engine.replan(plan.id, "Fix build errors and retry");
    assert.ok(result.replanned >= 1);
    assert.equal(result.reason, "Fix build errors and retry");

    const fullPlan = engine.getPlan(plan.id);
    const replanedStep = fullPlan.steps.find((s) => s.notes?.includes("Replanned"));
    assert.ok(replanedStep, "should have a replanned step");
    assert.equal(replanedStep.status, "pending");
  });

  it("detects deviation severity", () => {
    const result = engine.createPlan("Deviation test", [
      "Step 1", "Step 2", "Step 3", "Step 4",
    ]);
    const plan = engine.getPlan(result.planId);
    engine.updateStep(result.planId, plan.steps[0].id, "done");
    engine.updateStep(result.planId, plan.steps[1].id, "skipped", "Not needed");
    engine.updateStep(result.planId, plan.steps[2].id, "failed", "Error");

    const deviation = engine.detectDeviation(result.planId);
    assert.equal(deviation.severity, "medium");
    assert.ok(deviation.suggestions.length > 0);
  });

  it("completes a plan", () => {
    const plan = engine.listPlans("active")[0];
    engine.completePlan(plan.id);
    const updated = engine.getPlan(plan.id);
    assert.equal(updated.status, "completed");
  });

  it("requires goal for createPlan", () => {
    assert.throws(() => engine.createPlan(""), /goal is required/);
    assert.throws(() => engine.createPlan(null), /goal is required/);
  });

  it("rejects invalid step status", () => {
    const result = engine.createPlan("Status test", ["Step 1"]);
    const plan = engine.getPlan(result.planId);
    assert.throws(
      () => engine.updateStep(result.planId, plan.steps[0].id, "invalid_status"),
      /Invalid status/
    );
  });

  it("lists plans by status filter", () => {
    const active = engine.listPlans("active");
    const completed = engine.listPlans("completed");
    assert.ok(Array.isArray(active));
    assert.ok(Array.isArray(completed));
    assert.ok(completed.length >= 1);
  });
});
