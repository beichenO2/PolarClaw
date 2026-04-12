/**
 * @typedef {object} Diagnosis
 * @property {'network'|'timeout'|'rate_limit'|'validation'|'permission'|'transient'|'unknown'} category
 * @property {string} code
 * @property {string} message
 * @property {string[]} hints
 */

/**
 * @typedef {object} AutoFixResult
 * @property {boolean} applied
 * @property {string} action
 * @property {number} retryAfterMs
 * @property {string} [detail]
 */

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * @param {unknown} err
 * @returns {Error}
 */
function toError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : JSON.stringify(err));
}

/**
 * @param {Error} err
 * @returns {string | undefined}
 */
function errnoOf(err) {
  const any = /** @type {{ code?: string; cause?: { code?: string } }} */ (err);
  return any.code ?? any.cause?.code;
}

/**
 * @param {Error} err
 */
function classifyError(err) {
  const msg = `${err.name} ${err.message}`.toLowerCase();
  const code = errnoOf(err);

  if (err.name === "AbortError" || /aborted/i.test(err.message)) {
    return /** @type {const} */ ({
      category: "transient",
      code: "aborted",
    });
  }
  if (
    code === "ETIMEDOUT" ||
    /timeout|timed out/i.test(msg) ||
    err.name === "TimeoutError"
  ) {
    return /** @type {const} */ ({ category: "timeout", code: code ?? "timeout" });
  }
  if (
    code &&
    NETWORK_CODES.has(code) &&
    !/rate|429|quota/i.test(msg)
  ) {
    return /** @type {const} */ ({ category: "network", code });
  }
  if (/429|rate limit|too many requests|quota/i.test(msg)) {
    return /** @type {const} */ ({ category: "rate_limit", code: code ?? "rate_limit" });
  }
  if (/eacces|eperm|forbidden|unauthorized|401|403/i.test(msg)) {
    return /** @type {const} */ ({
      category: "permission",
      code: code ?? "permission",
    });
  }
  if (/invalid|validation|bad request|400|422/i.test(msg)) {
    return /** @type {const} */ ({
      category: "validation",
      code: code ?? "validation",
    });
  }
  if (/econnreset|econnrefused|network|fetch failed/i.test(msg)) {
    return /** @type {const} */ ({
      category: "network",
      code: code ?? "network",
    });
  }
  return /** @type {const} */ ({ category: "unknown", code: code ?? "unknown" });
}

/**
 * @param {unknown} error
 * @returns {Diagnosis}
 */
function diagnoseError(error) {
  const err = toError(error);
  const { category, code } = classifyError(err);
  /** @type {string[]} */
  const hints = [];

  if (category === "network") {
    hints.push("检查网络与 DNS，稍后重试；若是 TLS/代理问题，验证系统代理与环境变量。");
  } else if (category === "timeout") {
    hints.push("增大超时、减少并发，或把操作拆成更小的批次。");
  } else if (category === "rate_limit") {
    hints.push("遵守 Retry-After 或指数退避；降低请求频率。");
  } else if (category === "permission") {
    hints.push("核对凭据、令牌过期时间与最小权限范围。");
  } else if (category === "validation") {
    hints.push("对照 API/schema 校验输入；打印导致失败的字段。");
  } else {
    hints.push("收集完整堆栈与复现步骤；判断是确定性 bug 还是环境偶发。");
  }

  return {
    category,
    code,
    message: err.message,
    hints,
  };
}

export function createRecovery() {
  return {
    /**
     * @param {unknown} error
     */
    isRecoverable(error) {
      const err = toError(error);
      const { category } = classifyError(err);
      return (
        category === "network" ||
        category === "timeout" ||
        category === "rate_limit" ||
        category === "transient"
      );
    },

    /**
     * @param {unknown} error
     * @returns {Diagnosis}
     */
    diagnose(error) {
      return diagnoseError(error);
    },

    /**
     * @param {unknown} error
     * @param {Record<string, unknown>} [context]
     * @returns {AutoFixResult}
     */
    autoFix(error, context = {}) {
      const err = toError(error);
      const diagnosis = diagnoseError(err);
      const attempt = Number(context.attempt ?? 0);

      if (diagnosis.category === "rate_limit") {
        const header =
          typeof context.retryAfterSec === "number" &&
          Number.isFinite(context.retryAfterSec)
            ? context.retryAfterSec * 1000
            : null;
        const retryAfterMs = Math.min(
          120_000,
          Math.max(2000, header ?? 5000 + attempt * 2000),
        );
        return {
          applied: true,
          action: "backoff_rate_limit",
          retryAfterMs,
          detail: "使用退避等待以规避频率限制。",
        };
      }

      if (diagnosis.category === "timeout" || diagnosis.category === "network") {
        const retryAfterMs = Math.min(
          60_000,
          Math.max(500, 750 * 2 ** Math.min(attempt, 8)),
        );
        return {
          applied: true,
          action: "retry_with_exponential_backoff",
          retryAfterMs,
          detail: "网络/超时类错误：延长间隔后重试同一操作。",
        };
      }

      if (diagnosis.category === "transient") {
        return {
          applied: true,
          action: "retry_transient",
          retryAfterMs: Math.min(30_000, 300 + attempt * 400),
          detail: "短暂中断：小幅等待后重试。",
        };
      }

      return {
        applied: false,
        action: "no_auto_fix",
        retryAfterMs: 0,
        detail: "该错误类型不适合自动修复，需要人工或上游变更。",
      };
    },
  };
}
