export const securityDefaults = Object.freeze({
  sessionCookieName: "__myclaw_sid",
  csrfTokenHeader: "x-csrf-token",
  maxBodySizeBytes: 5 * 1024 * 1024,
  requestTimeoutMs: 30_000,
  minPasswordLength: 12,
  bcryptRounds: 12,
});

export const cspHeaders = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://dashscope.aliyuncs.com",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
});

export const secureCookieFlags = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
});

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function createInputSanitizer() {
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
  }

  function stripNullBytes(str) {
    if (typeof str !== "string") return "";
    return str.replace(/\0/g, "");
  }

  function trimToLength(str, max = 10_000) {
    if (typeof str !== "string") return "";
    return str.slice(0, max);
  }

  function sanitize(str, opts = {}) {
    const max = opts.maxLength ?? 10_000;
    let s = stripNullBytes(str);
    s = trimToLength(s, max);
    if (opts.html !== false) s = escapeHtml(s);
    return s;
  }

  function sanitizeObject(obj, opts = {}) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") return sanitize(obj, opts);
    if (Array.isArray(obj)) return obj.map((v) => sanitizeObject(v, opts));
    if (typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        out[sanitize(k, { maxLength: 200 })] = sanitizeObject(v, opts);
      }
      return out;
    }
    return obj;
  }

  return { escapeHtml, stripNullBytes, trimToLength, sanitize, sanitizeObject };
}
