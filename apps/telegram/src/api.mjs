/**
 * Library entry: safe to import (no CLI side effects).
 */
export { createTelegrafBot } from "./bot.mjs";
export { loadTelegramConfig, isSupportedUserDocument } from "./config.mjs";
