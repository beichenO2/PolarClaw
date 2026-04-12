import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "../src/scheduler.mjs";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("createScheduler() returns correct interface", () => {
  const s = createScheduler();
  assert.equal(typeof s.addJob, "function");
  assert.equal(typeof s.removeJob, "function");
  assert.equal(typeof s.listJobs, "function");
  assert.equal(typeof s.start, "function");
  assert.equal(typeof s.stop, "function");
});

test("addJob / removeJob / listJobs", () => {
  const s = createScheduler();
  let n = 0;
  s.addJob("a", 10_000, () => {
    n += 1;
  });
  assert.deepEqual(s.listJobs().map((j) => j.name), ["a"]);
  assert.equal(s.removeJob("missing"), false);
  assert.equal(s.removeJob("a"), true);
  assert.deepEqual(s.listJobs(), []);
  assert.equal(n, 0);
});

test("start / stop lifecycle", async () => {
  const s = createScheduler();
  s.addJob("tick", 50, () => {});
  s.start();
  s.stop();
  s.start();
  s.stop();
  assert.ok(true);
});

test("job fires on interval after start", async () => {
  const s = createScheduler();
  let runs = 0;
  s.addJob("fast", 50, () => {
    runs += 1;
  });
  s.start();
  await delay(150);
  s.stop();
  assert.ok(runs >= 1, `expected at least 1 run, got ${runs}`);
});
