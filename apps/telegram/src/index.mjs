#!/usr/bin/env node
/**
 * CLI: long-polling Telegram bot for MyClaw (dev / small deployments).
 */

import { isSupportedUserDocument, loadTelegramConfig } from "./config.mjs";
import { createTelegrafBot } from "./bot.mjs";

const config = loadTelegramConfig();

const bot = createTelegrafBot(config, {
  async onUserMessage(ctx, text) {
    // Placeholder: wire to OpenClaw gateway / runtime in a later phase
    await ctx.reply(`[MyClaw] task received (${text.length} chars). Bridge TBD.`);
  },
  async onUserDocument(ctx, meta) {
    const ok = isSupportedUserDocument(meta.fileName, meta.mimeType ?? "");
    if (!ok) {
      await ctx.reply(
        "Unsupported file type. Send PDF, PPT/PPTX, Office docs, images, or text.",
      );
      return;
    }
    await ctx.reply(
      `[MyClaw] file accepted: ${meta.fileName} (${meta.mimeType ?? "unknown"}) — processing pipeline TBD.`,
    );
  },
});

bot.launch().then(() => {
  console.error("myclaw-telegram: polling started");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
