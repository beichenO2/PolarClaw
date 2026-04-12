import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFlexiblePlanContext, formatMemoryContextBlock } from "../src/turn-context.mjs";

test("formatMemoryContextBlock: empty hits → empty string", () => {
  assert.equal(formatMemoryContextBlock({ userId: "u1", hits: [] }), "");
});

test("formatMemoryContextBlock: renders hits", () => {
  const s = formatMemoryContextBlock({
    userId: "u1",
    hits: [{ id: 1, content: "hello world" }],
  });
  assert.ok(s.includes("u1"));
  assert.ok(s.includes("#1"));
  assert.ok(s.includes("hello world"));
});

test("formatFlexiblePlanContext: empty", () => {
  assert.equal(
    formatFlexiblePlanContext({ goalsRaw: null, deviationsRaw: null }),
    "",
  );
});

test("formatFlexiblePlanContext: JSON goals array", () => {
  const s = formatFlexiblePlanContext({
    goalsRaw: '["a","b"]',
    deviationsRaw: "delayed 1d",
  });
  assert.ok(s.includes("当前目标"));
  assert.ok(s.includes("- a"));
  assert.ok(s.includes("偏差"));
});
