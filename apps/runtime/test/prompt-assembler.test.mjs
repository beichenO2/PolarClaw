import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { assemblePrompt } from "../src/prompt-assembler.mjs";

test("assemblePrompt combines SOUL and AGENTS with separator", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "myclaw-prompt-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  await writeFile(
    path.join(dir, "SOUL.md"),
    "Be kind.\n",
    "utf8"
  );
  await writeFile(
    path.join(dir, "AGENTS.md"),
    "Use tools wisely.\n",
    "utf8"
  );

  const prompt = await assemblePrompt(dir);

  assert.ok(prompt.includes("# SOUL"));
  assert.ok(prompt.includes("Be kind."));
  assert.ok(prompt.includes("# AGENTS"));
  assert.ok(prompt.includes("Use tools wisely."));
  assert.ok(prompt.includes("\n\n---\n\n"));
  assert.match(prompt, /# SOUL[\s\S]*# AGENTS/);
});

test("assemblePrompt rejects empty dir argument", async () => {
  await assert.rejects(() => assemblePrompt(""), TypeError);
  await assert.rejects(() => assemblePrompt("   "), TypeError);
});

test("assemblePrompt throws when no markdown files exist", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "myclaw-empty-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    () => assemblePrompt(dir),
    /neither AGENTS\.md nor SOUL\.md/
  );
});

test("assemblePrompt optional append blocks", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "myclaw-append-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  await writeFile(path.join(dir, "SOUL.md"), "Core.\n", "utf8");
  const p = await assemblePrompt(dir, { append: "## Extra\n\nmore" });
  assert.ok(p.includes("Core."));
  assert.ok(p.includes("## Extra"));
  assert.ok(p.includes("\n\n---\n\n## Extra"));
});

test("assemblePrompt includes only present file", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "myclaw-soul-only-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  await writeFile(path.join(dir, "SOUL.md"), "Solo soul.\n", "utf8");

  const prompt = await assemblePrompt(dir);
  assert.ok(prompt.includes("# SOUL"));
  assert.ok(prompt.includes("Solo soul."));
  assert.ok(!prompt.includes("# AGENTS"));
});
