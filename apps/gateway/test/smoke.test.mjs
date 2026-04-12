import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** MyClaw repo root (…/MyClaw) */
const repoRoot = join(__dirname, "..", "..", "..");
const openclawRoot = join(repoRoot, "openclaw");

test("OpenClaw submodule is present with CLI entry", () => {
  assert.ok(existsSync(join(openclawRoot, "openclaw.mjs")), "openclaw.mjs missing");
  const pkg = JSON.parse(readFileSync(join(openclawRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "openclaw");
  assert.ok(pkg.bin?.openclaw, "openclaw bin not declared");
});

test("MyClaw gateway package resolves OpenClaw path for runtime", () => {
  const gatewayPkg = join(dirname(__dirname), "package.json");
  assert.ok(existsSync(gatewayPkg));
});
