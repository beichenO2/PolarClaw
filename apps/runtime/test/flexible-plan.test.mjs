import { test } from "node:test";
import assert from "node:assert/strict";
import { createFlexiblePlanTracker } from "../src/flexible-plan.mjs";

test("createFlexiblePlanTracker advances and records deviations", () => {
  const t = createFlexiblePlanTracker(["a", "b", "c"]);
  assert.equal(t.currentStep, "a");
  assert.equal(t.advance(), "b");
  assert.equal(t.recordDeviation("delay 1d"), 1);
  assert.equal(t.advance(), "c");
  assert.equal(t.advance(), null);
  assert.equal(t.isComplete, true);
  assert.equal(t.listDeviations().length, 1);
});

test("createFlexiblePlanTracker rejects empty input", () => {
  assert.throws(() => createFlexiblePlanTracker([]), /non-empty/);
});
