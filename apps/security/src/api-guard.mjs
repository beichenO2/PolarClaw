/**
 * @typedef {object} ApiGuardOptions
 * @property {string[]} [validTokens] - Accepted Bearer tokens
 * @property {number} [rateLimit] - Max requests per window (default 100)
 * @property {number} [rateLimitWindowMs] - Window duration in ms (default 60000)
 * @property {string[]} [corsOrigins] - Allowed CORS origins (* for any)
 */

/**
 * @param {ApiGuardOptions} [options]
 */
export function createApiGuard(options = {}) {
  const validTokens = new Set(options.validTokens ?? []);
  const rateMax = options.rateLimit ?? 100;
  const rateWindow = options.rateLimitWindowMs ?? 60_000;
  const corsOrigins = new Set(options.corsOrigins ?? ["*"]);

  const buckets = new Map();

  function authenticate(req) {
    if (validTokens.size === 0) return { ok: true, reason: "no_tokens_configured" };

    const authHeader = req.headers?.["authorization"] ?? req.headers?.Authorization ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return { ok: false, status: 401, reason: "missing_bearer_token" };
    }
    const token = authHeader.slice(7).trim();
    if (!validTokens.has(token)) {
      return { ok: false, status: 403, reason: "invalid_token" };
    }
    return { ok: true };
  }

  function rateLimit(clientId) {
    const now = Date.now();
    let bucket = buckets.get(clientId);

    if (!bucket || now - bucket.windowStart > rateWindow) {
      bucket = { windowStart: now, count: 0 };
      buckets.set(clientId, bucket);
    }

    bucket.count++;

    if (bucket.count > rateMax) {
      return {
        ok: false,
        status: 429,
        reason: "rate_limit_exceeded",
        retryAfterMs: rateWindow - (now - bucket.windowStart),
      };
    }
    return { ok: true, remaining: rateMax - bucket.count };
  }

  function corsCheck(origin) {
    if (corsOrigins.has("*")) return { ok: true, allowOrigin: origin || "*" };
    if (!origin) return { ok: false, reason: "missing_origin" };
    if (corsOrigins.has(origin)) return { ok: true, allowOrigin: origin };
    return { ok: false, reason: "origin_not_allowed" };
  }

  function corsHeaders(origin) {
    const check = corsCheck(origin);
    if (!check.ok) return {};
    return {
      "Access-Control-Allow-Origin": check.allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
  }

  function addToken(token) { validTokens.add(token); }
  function removeToken(token) { validTokens.delete(token); }
  function addCorsOrigin(origin) { corsOrigins.add(origin); }

  function resetBuckets() { buckets.clear(); }

  return {
    authenticate,
    rateLimit,
    corsCheck,
    corsHeaders,
    addToken,
    removeToken,
    addCorsOrigin,
    resetBuckets,
  };
}
