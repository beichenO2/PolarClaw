import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSupportedUserDocument,
  loadTelegramConfig,
} from "../src/config.mjs";

test("loadTelegramConfig requires token", () => {
  assert.throws(
    () => loadTelegramConfig({}),
    /TELEGRAM_BOT_TOKEN is required/,
  );
  const cfg = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: "  abc:token  ",
  });
  assert.equal(cfg.token, "abc:token");
});

test("loadTelegramConfig parses TELEGRAM_ALLOW_FROM", () => {
  const cfg = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_ALLOW_FROM: " 1 , 2 ",
  });
  assert.ok(cfg.allowFrom.has("1"));
  assert.ok(cfg.allowFrom.has("2"));
  assert.equal(cfg.allowFrom.size, 2);
});

test("isSupportedUserDocument accepts REQ-040 examples", () => {
  assert.equal(isSupportedUserDocument("slides.pptx"), true);
  assert.equal(isSupportedUserDocument("paper.pdf"), true);
  assert.equal(isSupportedUserDocument("x.png"), true);
  assert.equal(isSupportedUserDocument("z", "application/pdf"), true);
  assert.equal(isSupportedUserDocument("z", "image/webp"), true);
});

test("isSupportedUserDocument rejects unknown types", () => {
  assert.equal(isSupportedUserDocument("binary.exe"), false);
  assert.equal(isSupportedUserDocument("x", "application/octet-stream"), false);
});
