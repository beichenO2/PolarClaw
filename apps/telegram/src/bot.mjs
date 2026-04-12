/**
 * Telegraf wiring: text → task bridge, documents → file bridge (REQ-040).
 */

import { Telegraf } from "telegraf";

/**
 * @typedef {object} TelegramBridges
 * @property {(ctx: object, text: string) => Promise<void> | void} onUserMessage
 * @property {(ctx: object, meta: {
 *   fileId: string
 *   fileName: string
 *   mimeType?: string
 *   fileUniqueId: string
 * }) => Promise<void> | void} onUserDocument
 */

/**
 * @param {import('./config.mjs').TelegramBotConfig} config
 * @param {TelegramBridges} bridges
 */
export function createTelegrafBot(config, bridges) {
  const bot = new Telegraf(config.token);

  bot.use(async (ctx, next) => {
    const uid = String(ctx.from?.id ?? "");
    if (config.allowFrom.size > 0 && uid && !config.allowFrom.has(uid)) {
      return;
    }
    return next();
  });

  bot.start(async (ctx) => {
    await ctx.reply(
      "MyClaw bot online. Send a message (task hint) or a document (PPT/PDF/images).",
    );
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text?.trim() ?? "";
    if (!text || text.startsWith("/")) {
      return;
    }
    await bridges.onUserMessage(ctx, text);
  });

  bot.on("document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc) {
      return;
    }
    const fileName = doc.file_name ?? "unnamed";
    await bridges.onUserDocument(ctx, {
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      fileName,
      mimeType: doc.mime_type,
    });
  });

  bot.on("photo", async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos?.length) {
      return;
    }
    const best = photos[photos.length - 1];
    await bridges.onUserDocument(ctx, {
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
    });
  });

  return bot;
}
