/**
 * Load and validate Telegram bot env (REQ-040).
 */

/** @typedef {{ token: string, allowFrom: Set<string> }} TelegramBotConfig */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {TelegramBotConfig}
 */
export function loadTelegramConfig(env = process.env) {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  const raw = (env.TELEGRAM_ALLOW_FROM ?? "").trim();
  const allowFrom = new Set(
    raw
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
  return { token, allowFrom };
}

/**
 * PPT/PDF and common doc types for REQ-040 file transfer.
 * @param {string} fileName
 * @param {string} [mimeType]
 */
export function isSupportedUserDocument(fileName, mimeType = "") {
  const lower = fileName.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  const docExts = new Set([
    ".pdf",
    ".ppt",
    ".pptx",
    ".doc",
    ".docx",
    ".txt",
    ".md",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
  ]);
  if (ext && docExts.has(ext)) {
    return true;
  }
  if (mimeType.startsWith("image/") || mimeType === "application/pdf") {
    return true;
  }
  return false;
}
