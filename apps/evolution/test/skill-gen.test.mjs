import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  generateSkill,
  saveSkill,
  slugifySkillName,
} from "../src/skill-gen.mjs";

describe("slugifySkillName", () => {
  it("normalizes to agentskills-style slug", () => {
    assert.equal(slugifySkillName("Fix API Rate Limits!!"), "fix-api-rate-limits");
    assert.equal(slugifySkillName("  "), "learned-skill");
  });

  it("truncates to 64 chars", () => {
    const long = "a".repeat(100);
    assert.ok(slugifySkillName(long).length <= 64);
  });
});

describe("generateSkill", () => {
  it("produces YAML frontmatter and body from steps", () => {
    const md = generateSkill({
      taskTitle: "deploy-canary",
      taskSummary: "Roll out a canary deployment and verify metrics.",
      steps: [
        {
          description: "Build image",
          tool: "docker",
          action: "docker build -t app:canary .",
          result: "Image ID abc123",
        },
        {
          description: "Roll out",
          action: "kubectl set image deploy/app app=app:canary",
          result: "deployment.apps/app image updated",
        },
      ],
    });

    assert.match(md, /^---\nname: deploy-canary\n/);
    assert.match(md, /^description: /m);
    assert.match(md, /step-count: 2/);
    assert.match(md, /## 1\. Build image/);
    assert.match(md, /\*\*Tool\*\*: `docker`/);
    assert.match(md, /## 2\. Roll out/);
    assert.match(md, /Edge cases/);
  });

  it("handles empty steps with fallback description", () => {
    const md = generateSkill({ steps: [] });
    assert.match(md, /^---\nname: learned-task\n/);
    assert.ok(md.includes("execution step"));
  });
});

describe("saveSkill", () => {
  it("writes SKILL.md under skillDir/name/", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-skill-"));
    const name = "my-test-skill";
    const content = "---\nname: my-test-skill\ndescription: Test.\n---\n\n# Body\n";
    await saveSkill(tmp, name, content);
    const written = await fs.readFile(path.join(tmp, name, "SKILL.md"), "utf8");
    assert.equal(written, content);
  });
});
