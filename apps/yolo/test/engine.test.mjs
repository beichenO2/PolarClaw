import { test } from "node:test";
import assert from "node:assert/strict";
import { createYoloEngine } from "../src/engine.mjs";

/** Short backoff for tests (default recovery uses multi-second waits). */
function createFastRecovery() {
  return {
    isRecoverable() {
      return true;
    },
    autoFix() {
      return {
        applied: true,
        action: "test_fast_retry",
        retryAfterMs: 5,
        detail: "test",
      };
    },
  };
}

test("createYoloEngine returns correct interface", () => {
  const engine = createYoloEngine();
  assert.equal(typeof engine.execute, "function");
  assert.equal(typeof engine.getStatus, "function");
  assert.equal(typeof engine.onProgress, "function");
});

test("execute() runs steps in order", async () => {
  const engine = createYoloEngine({ recovery: createFastRecovery() });
  const order = [];
  await engine.execute({
    id: "p1",
    steps: [
      {
        id: "s1",
        run() {
          order.push(1);
        },
      },
      {
        id: "s2",
        run() {
          order.push(2);
        },
      },
    ],
  });
  assert.deepEqual(order, [1, 2]);
});

test("error recovery: step fails then succeeds on retry", async () => {
  const engine = createYoloEngine({ recovery: createFastRecovery() });
  let calls = 0;
  await engine.execute({
    id: "retry-plan",
    steps: [
      {
        id: "flaky",
        run() {
          calls += 1;
          if (calls === 1) {
            throw new Error("first fail");
          }
        },
      },
    ],
  });
  assert.equal(calls, 2);
});

test("onProgress callback receives events", async () => {
  const engine = createYoloEngine({ recovery: createFastRecovery() });
  /** @type {string[]} */
  const types = [];
  const unsub = engine.onProgress((ev) => {
    types.push(ev.type);
  });
  await engine.execute({
    id: "prog",
    steps: [
      {
        id: "only",
        run() {},
      },
    ],
  });
  unsub();
  assert.ok(types.includes("step_start"));
  assert.ok(types.includes("step_success"));
  assert.ok(types.includes("plan_complete"));
});

test("onProgress sees retry path after failure", async () => {
  const engine = createYoloEngine({ recovery: createFastRecovery() });
  let n = 0;
  /** @type {string[]} */
  const types = [];
  engine.onProgress((ev) => types.push(ev.type));
  await engine.execute({
    id: "retry-prog",
    steps: [
      {
        id: "x",
        run() {
          n += 1;
          if (n === 1) throw new Error("boom");
        },
      },
    ],
  });
  assert.ok(types.includes("step_error"));
  assert.ok(types.includes("step_retry"));
});
