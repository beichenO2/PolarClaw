import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSkillsFromDir } from "../src/loader.js";
import { parseSkillFrontmatter } from "../src/frontmatter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

test("loadSkillsFromDir: nested folders", () => {
  const { skills } = loadSkillsFromDir({
    dir: path.join(fixtures, "nested"),
    source: "test",
  });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "demo-skill");
  assert.equal(skills[0].skillKey, "demo");
  assert.match(skills[0].description, /demonstration/);
  assert.equal(skills[0].source, "test");
});

test("loadSkillsFromDir: root-level SKILL.md", () => {
  const { skills } = loadSkillsFromDir({
    dir: path.join(fixtures, "root-skill"),
    source: "workspace",
  });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "root-only");
});

test("loadSkillsFromDir: skips invalid skills", () => {
  const { skills } = loadSkillsFromDir({
    dir: path.join(fixtures, "bad-missing-desc"),
    source: "test",
  });
  assert.equal(skills.length, 0);
});

test("loadSkillsFromDir: missing directory", () => {
  const { skills } = loadSkillsFromDir({
    dir: path.join(fixtures, "does-not-exist"),
    source: "test",
  });
  assert.equal(skills.length, 0);
});

test("parseSkillFrontmatter: no frontmatter", () => {
  assert.deepEqual(parseSkillFrontmatter("# Hello"), {});
});
