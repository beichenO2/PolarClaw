/**
 * MyClaw gateway defaults — aligned with OpenClaw local dev (see openclaw UI placeholders).
 */
export const MYCLAW_DEFAULT_GATEWAY_PORT = 18789;

/** @param {string} [host] */
export function myclawGatewayWsUrl(host = "127.0.0.1") {
  return `ws://${host}:${MYCLAW_DEFAULT_GATEWAY_PORT}`;
}
