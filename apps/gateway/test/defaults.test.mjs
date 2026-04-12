import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MYCLAW_DEFAULT_GATEWAY_PORT,
  myclawGatewayWsUrl,
} from "../src/defaults.mjs";

test("default port matches OpenClaw local convention", () => {
  assert.equal(MYCLAW_DEFAULT_GATEWAY_PORT, 18789);
  assert.equal(myclawGatewayWsUrl(), "ws://127.0.0.1:18789");
});
