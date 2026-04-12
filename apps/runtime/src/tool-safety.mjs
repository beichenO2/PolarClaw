/**
 * Lightweight guards for tool execution — complements future apps/security sandboxing.
 */

const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 +]+PRIVATE KEY-----/;
const AWS_KEY_ID_RE = /\bAKIA[0-9A-Z]{16}\b/;
const GITHUB_PAT_RE = /\bghp_[a-zA-Z0-9]{36}\b/;
const OPENAI_SK_RE = /\bsk-[a-zA-Z0-9]{20,}\b/;

/**
 * Throws if serialized args look like they contain high-risk secret material.
 * Intended for `createToolExecutor({ beforeExecute: assertToolArgsSafe })`.
 *
 * @param {string} name
 * @param {object} args
 */
export function assertToolArgsSafe(name, args) {
  if (args === null || typeof args !== "object") return;
  const blob = JSON.stringify(args);
  if (PRIVATE_KEY_RE.test(blob)) {
    throw new Error(`tool "${name}" blocked: PEM/private key material in arguments`);
  }
  if (AWS_KEY_ID_RE.test(blob)) {
    throw new Error(`tool "${name}" blocked: possible AWS access key id in arguments`);
  }
  if (GITHUB_PAT_RE.test(blob)) {
    throw new Error(`tool "${name}" blocked: possible GitHub token in arguments`);
  }
  if (OPENAI_SK_RE.test(blob)) {
    throw new Error(`tool "${name}" blocked: possible API secret-like token in arguments`);
  }
}
