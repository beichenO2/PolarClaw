import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryStore,
  createSearchEngine,
  createProfileManager,
} from "../src/index.mjs";

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-memory-"));
  return { dir, path: join(dir, "test.db") };
}

test("createMemoryStore: CRUD memories and FTS search", async (t) => {
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

  const a = store.saveMemory({
    type: "note",
    content: "hello world sqlite fts5",
    tags: "demo,search",
    metadata: JSON.stringify({ src: "test" }),
  });
  assert.ok(a.id >= 1);
  assert.equal(a.type, "note");

  const b = store.saveMemory({
    content: "other topic dinosaurs",
    tags: "arch",
  });
  assert.ok(b.id > a.id);

  const found = store.getMemory(a.id);
  assert.ok(found);
  assert.equal(found.content, "hello world sqlite fts5");

  const sr = search.search("hello fts5", { limit: 10 });
  assert.ok(sr.total >= 1);
  assert.ok(sr.rows.some((r) => r.id === a.id));

  const recent = search.recentMemories(5);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].id, b.id);

  const sim = search.findSimilar(a.id);
  assert.ok(Array.isArray(sim.rows));

  const updated = store.saveMemory({
    id: a.id,
    content: "updated hello",
    tags: "demo",
  });
  assert.equal(updated.id, a.id);
  assert.equal(updated.content, "updated hello");

  const del = store.deleteMemory(b.id);
  assert.equal(del, true);
  assert.equal(store.getMemory(b.id), undefined);

  store.close();
});

test("createMemoryStore: user_profiles and profile manager", async (t) => {
  const { dir, path } = tempDbPath();
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const store = createMemoryStore(path);
  const profiles = createProfileManager(store);

  store.saveProfile("u1", "theme", "dark");
  assert.equal(store.getProfile("u1", "theme"), "dark");

  profiles.updatePreference("u1", "locale", "zh-CN");
  const prefs = profiles.getPreferences("u1");
  assert.equal(prefs.locale, "zh-CN");

  profiles.recordInteraction("u1", { kind: "click", target: "home" });
  const p = profiles.getProfile("u1");
  assert.equal(p.interactions.length, 1);
  assert.equal(p.interactions[0].kind, "click");

  const entries = store.listProfileEntries("u1");
  assert.ok(entries.some((e) => e.key === "theme" && e.value === "dark"));
  assert.ok(entries.some((e) => e.key.startsWith("pref:")));

  store.close();
});

test("createMemoryStore: validation errors", async (t) => {
  const { dir, path } = tempDbPath();
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const store = createMemoryStore(path);

  assert.throws(() => store.saveMemory(null), TypeError);
  assert.throws(() => store.getMemory(0), TypeError);
  assert.throws(() => store.deleteMemory(-1), TypeError);

  store.close();
});
