/**
 * Integration tests: core config + cross-module wiring (llm, runtime, memory, evolution, proactive, yolo).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.mjs";
import { createRouter } from "@myclaw/llm";
import { assemblePrompt, createToolExecutor } from "@myclaw/runtime";
import { createMemoryStore, createSearchEngine } from "@myclaw/memory";
import { generateSkill } from "@myclaw/evolution/skill-gen";
import { createScheduler } from "@myclaw/proactive";
import { createYoloEngine } from "@myclaw/yolo";

/** Repo root: apps/core/test → ../../../ */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-core-int-"));
  return { dir, path: join(dir, "memory.db") };
}

function minimalLlmEnv(overrides = {}) {
  return {
    MYCLAW_LLM_API_KEY: "test-integration-key",
    MYCLAW_PROJECT_ROOT: REPO_ROOT,
    ...overrides,
  };
}

test("loadConfig: minimal env (MYCLAW_LLM_API_KEY + existing projectRoot)", () => {
  const cfg = loadConfig(undefined, minimalLlmEnv());
  assert.equal(cfg.llm.apiKey, "test-integration-key");
  assert.equal(resolve(cfg.projectRoot), resolve(REPO_ROOT));
  assert.match(cfg.llm.baseUrl, /^https:\/\//);
  assert.ok(cfg.memory.dbPath);
  assert.equal(cfg.channels.telegram, false);
  assert.equal(cfg.channels.feishu, false);
});

test("LLM router: coding / research / vision intents map to expected models", () => {
  const router = createRouter();
  const coding = router.resolveModelForMessages(
    [{ role: "user", content: "refactor this TypeScript function and fix the bug" }],
    { lastUserOnly: true },
  );
  assert.equal(coding.intent, "coding");
  assert.equal(coding.model, "qwen/qwen3-coder-next");

  const research = router.resolveModelForMessages(
    [{ role: "user", content: "论文综述与文献对比分析" }],
    { lastUserOnly: true },
  );
  assert.equal(research.intent, "research");
  assert.equal(research.model, "qwen/qwen3.5-plus");

  const vision = router.resolveModelForMessages(
    [{ role: "user", content: "describe this screenshot png image" }],
    { lastUserOnly: true },
  );
  assert.equal(vision.intent, "vision");
  assert.equal(vision.model, "qwen/qwen3-vl-plus");
});

test("assemblePrompt: reads AGENTS.md + SOUL.md from project root", async () => {
  const prompt = await assemblePrompt(REPO_ROOT);
  assert.ok(prompt.includes("# SOUL"));
  assert.ok(prompt.includes("# AGENTS"));
  assert.ok(prompt.includes("MyClaw"));
  assert.ok(/\n---\n/.test(prompt));
});

test("createToolExecutor: register, list, execute", async () => {
  const tools = createToolExecutor();
  tools.register({
    name: "echo_test",
    description: "returns args.x",
    parameters: {
      type: "object",
      properties: { x: { type: "string" } },
    },
    handler(args) {
      return { echoed: String(args.x ?? "") };
    },
  });

  const listed = tools.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].type, "function");
  assert.equal(listed[0].function.name, "echo_test");

  const out = await tools.execute("echo_test", { x: "hi" });
  assert.deepEqual(out, { echoed: "hi" });
});

test("memory store: save + get + FTS search (temp db)", async (t) => {
  const { dir, path } = tempDbPath();
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const store = createMemoryStore(path);
  const search = createSearchEngine(store);

  const row = store.saveMemory({
    type: "note",
    content: "integration test memory banana fts",
    tags: "test,integration",
    metadata: JSON.stringify({ suite: "core" }),
  });
  assert.ok(row.id >= 1);

  const got = store.getMemory(row.id);
  assert.ok(got);
  assert.equal(got.content, "integration test memory banana fts");

  const sr = search.search("banana fts", { limit: 10 });
  assert.ok(sr.total >= 1);
  assert.ok(sr.rows.some((r) => r.id === row.id));

  store.close();
});

test("skill generator: generateSkill produces valid SKILL.md-shaped output", () => {
  const md = generateSkill({
    taskTitle: "Deploy API",
    taskSummary: "Roll out the REST API to staging.",
    steps: [
      {
        description: "Run build",
        action: "npm run build",
        tool: "shell",
        result: "ok",
      },
      {
        description: "Smoke test",
        action: "curl /health",
      },
    ],
  });

  assert.match(md, /^---\s*\n/);
  assert.ok(md.includes("name: deploy-api"));
  assert.ok(md.includes("description:"));
  assert.ok(md.includes("# Overview"));
  assert.ok(md.includes("# Procedure"));
  assert.ok(md.includes("## 1."));
  assert.ok(md.includes("# Edge cases"));
});

test("scheduler: add, list, remove jobs", () => {
  const scheduler = createScheduler();
  const runs = { a: 0, b: 0 };
  scheduler.addJob("job-a", 60_000, () => {
    runs.a += 1;
  });
  scheduler.addJob("job-b", 60_000, () => {
    runs.b += 1;
  });

  let jobs = scheduler.listJobs();
  assert.equal(jobs.length, 2);
  assert.ok(jobs.some((j) => j.name === "job-a"));
  assert.ok(jobs.some((j) => j.name === "job-b"));

  assert.equal(scheduler.removeJob("job-a"), true);
  jobs = scheduler.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, "job-b");

  scheduler.stop();
});

test("yolo engine: runs simple single-step plan to completion", async () => {
  const engine = createYoloEngine();
  const seen = [];
  engine.onProgress((ev) => seen.push(ev.type));

  await engine.execute({
    id: "plan-int",
    steps: [
      {
        id: "step-1",
        name: "noop",
        run() {
          return { ok: true };
        },
      },
    ],
  });

  const st = engine.getStatus();
  assert.equal(st.running, false);
  assert.equal(st.completedSteps, 1);
  assert.ok(seen.includes("step_start"));
  assert.ok(seen.includes("step_success"));
  assert.ok(seen.includes("plan_complete"));
});
