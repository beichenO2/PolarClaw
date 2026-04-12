/**
 * Channel manager: Telegram + Feishu registration, inbound routing, broadcast.
 */

import { createTelegrafBot, isSupportedUserDocument } from "@myclaw/telegram/api";
import { createFeishuBot } from "@myclaw/feishu";

/**
 * @typedef {ReturnType<import('./config.mjs').loadConfig>} ResolvedConfig
 */

/**
 * @param {{ handleMessage: (channel: string, message: string | { text: string; userId?: string; botToken?: string }) => Promise<string> }} agent
 * @param {ResolvedConfig} config
 */
export function createChannelManager(agent, config) {
  /** @type {Map<string, import('telegraf').Telegraf>} */
  const telegramBots = new Map();
  /** @type {Set<string>} */
  const telegramChatIds = new Set();
  /** @type {ReturnType<import('@myclaw/feishu').createFeishuBot> | null} */
  let feishuApp = null;
  /** @type {Set<string>} */
  const feishuChatIds = new Set();

  /**
   * Telegram `sendMessage` 需要 chat id（私聊与群聊均适用）。
   * @param {string} chatId
   */
  function trackTelegramChat(chatId) {
    if (chatId) telegramChatIds.add(chatId);
  }

  /**
   * @param {string} chatId
   */
  function trackFeishuChat(chatId) {
    if (chatId) feishuChatIds.add(chatId);
  }

  return {
    /**
     * Launch a single Telegram bot instance.
     * @param {string} token
     * @param {string} label
     */
    async launchTelegramBot(token, label) {
      const bot = createTelegrafBot(
        { token, allowFrom: config.telegram.allowFrom },
        {
          async onUserMessage(ctx, text) {
            const chatId = String(ctx.chat?.id ?? "");
            const uid = String(ctx.from?.id ?? chatId);
            trackTelegramChat(chatId);
            const replyText = await agent.handleMessage("telegram", { text, userId: uid, botToken: token });
            await ctx.reply(replyText);
          },
          async onUserDocument(ctx, meta) {
            const chatId = String(ctx.chat?.id ?? "");
            const uid = String(ctx.from?.id ?? chatId);
            trackTelegramChat(chatId);
            const ok = isSupportedUserDocument(meta.fileName, meta.mimeType ?? "");
            if (!ok) {
              await ctx.reply("不支持的文件类型。可发送 PDF、PPT/PPTX、Office 文档、图片或纯文本。");
              return;
            }
            const hint = `[用户上传文件] ${meta.fileName}（${meta.mimeType ?? "unknown"}）`;
            const replyText = await agent.handleMessage("telegram", { text: hint, userId: uid, botToken: token });
            await ctx.reply(replyText);
          },
        },
      );

      telegramBots.set(label, bot);
      await bot.launch();
      console.error(`[@myclaw/core] Telegram bot "${label}" polling started`);
    },

    /**
     * Start Telegram long-polling. Supports multi-bot (admin + girlfriend) or single legacy token.
     * @returns {Promise<{ stop: () => Promise<void> } | null>}
     */
    async registerTelegram() {
      if (!config.channels.telegram) {
        return null;
      }

      const hasMulti = !!(config.telegram.adminToken || config.telegram.girlfriendToken);
      const hasLegacy = !!config.telegram.token;

      if (!hasMulti && !hasLegacy) {
        console.error("[@myclaw/core] Telegram skipped: no tokens configured");
        return null;
      }

      if (hasMulti) {
        if (config.telegram.adminToken) {
          await this.launchTelegramBot(config.telegram.adminToken, "admin");
        }
        if (config.telegram.girlfriendToken) {
          await this.launchTelegramBot(config.telegram.girlfriendToken, "girlfriend");
        }
      } else {
        await this.launchTelegramBot(config.telegram.token, "default");
      }

      return {
        async stop() {
          for (const [label, bot] of telegramBots) {
            try {
              await bot.stop();
            } catch (e) {
              console.error(`[@myclaw/core] Telegram bot "${label}" stop error:`, e);
            }
          }
          telegramBots.clear();
        },
      };
    },

    /**
     * Start Feishu WebSocket or webhook server from config.
     * @returns {Promise<{ stop: () => Promise<void> } | null>}
     */
    async registerFeishu() {
      if (!config.channels.feishu) {
        return null;
      }
      const { appId, appSecret, verificationToken, encryptKey, domain, allowFrom, webhookHost, webhookPort, webhookPath, transport } =
        config.feishu;
      if (!appId || !appSecret || !verificationToken) {
        console.error("[@myclaw/core] Feishu skipped: missing appId / appSecret / verificationToken");
        return null;
      }

      const app = createFeishuBot(
        {
          appId,
          appSecret,
          encryptKey,
          verificationToken,
          domain: domain === "lark" ? "lark" : "feishu",
          allowFrom,
          webhookHost,
          webhookPort,
          webhookPath,
        },
        {
          async onUserMessage(ctx, text) {
            trackFeishuChat(ctx.chatId);
            const userKey = ctx.openId ?? ctx.chatId;
            const replyText = await agent.handleMessage("feishu", { text, userId: userKey });
            await ctx.replyText(replyText);
          },
          async onUserDocument(ctx, meta) {
            trackFeishuChat(ctx.chatId);
            const userKey = ctx.openId ?? ctx.chatId;
            const hint = `[用户上传文件] ${meta.fileName}`;
            const replyText = await agent.handleMessage("feishu", { text: hint, userId: userKey });
            await ctx.replyText(replyText);
          },
        },
      );

      feishuApp = app;

      if (transport === "webhook") {
        await app.startWebhookServer({ host: webhookHost, port: webhookPort, path: webhookPath });
        console.error(
          `[@myclaw/core] Feishu webhook listening on http://${webhookHost}:${webhookPort}${webhookPath}`,
        );
      } else {
        await app.startWebSocket();
        console.error("[@myclaw/core] Feishu WebSocket client started");
      }

      return {
        async stop() {
          if (!feishuApp) return;
          feishuApp.stopWebSocket();
          await feishuApp.stopWebhookServer();
          feishuApp = null;
        },
      };
    },

    /**
     * Send a message to a specific chat on a specific channel.
     * @param {string} channel
     * @param {string} chatId
     * @param {string} text
     */
    async sendToChat(channel, chatId, text) {
      if (channel === "telegram") {
        for (const [, bot] of telegramBots) {
          try {
            await bot.telegram.sendMessage(chatId, text);
            return;
          } catch {
            /* try next bot */
          }
        }
        throw new Error(`No Telegram bot could send to chat ${chatId}`);
      }
      if (channel === "feishu" && feishuApp?.client) {
        await feishuApp.client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "text",
            content: JSON.stringify({ text }),
          },
        });
        return;
      }
      throw new Error(`Cannot send to channel "${channel}" / chat "${chatId}"`);
    },

    /**
     * Best-effort fan-out to all known Telegram chats and Feishu chats (from prior inbound traffic).
     * @param {string} message
     */
    async broadcast(message) {
      const text = String(message ?? "");
      if (!text) return;

      for (const [, bot] of telegramBots) {
        for (const chatId of telegramChatIds) {
          try {
            await bot.telegram.sendMessage(chatId, text);
          } catch (e) {
            console.error(`[@myclaw/core] Telegram broadcast failed for ${chatId}:`, e);
          }
        }
      }

      if (feishuApp?.client) {
        for (const chatId of feishuChatIds) {
          try {
            await feishuApp.client.im.message.create({
              params: { receive_id_type: "chat_id" },
              data: {
                receive_id: chatId,
                msg_type: "text",
                content: JSON.stringify({ text }),
              },
            });
          } catch (e) {
            console.error(`[@myclaw/core] Feishu broadcast failed for ${chatId}:`, e);
          }
        }
      }
    },

    /** @returns {{ telegram: boolean; telegramBotCount: number; feishu: boolean; telegramChats: number; feishuChats: number }} */
    getChannelStats() {
      return {
        telegram: telegramBots.size > 0,
        telegramBotCount: telegramBots.size,
        feishu: feishuApp != null,
        telegramChats: telegramChatIds.size,
        feishuChats: feishuChatIds.size,
      };
    },
  };
}
