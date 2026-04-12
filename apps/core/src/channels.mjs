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
  /** @type {Map<string, ReturnType<import('@myclaw/feishu').createFeishuBot>>} */
  const feishuBots = new Map();
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
     * Launch a single Feishu bot instance (WebSocket or webhook).
     * @param {{ appId: string; appSecret: string; verificationToken: string; encryptKey: string }} creds
     * @param {string} label
     * @param {{ webhookPort?: number }} [overrides]
     */
    async launchFeishuBot(creds, label, overrides) {
      const { domain, allowFrom, webhookHost, webhookPort, webhookPath, transport } = config.feishu;
      const app = createFeishuBot(
        {
          appId: creds.appId,
          appSecret: creds.appSecret,
          encryptKey: creds.encryptKey,
          verificationToken: creds.verificationToken,
          domain: domain === "lark" ? "lark" : "feishu",
          allowFrom,
          webhookHost,
          webhookPort: overrides?.webhookPort ?? webhookPort,
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

      feishuBots.set(label, app);

      if (transport === "webhook") {
        const port = overrides?.webhookPort ?? webhookPort;
        await app.startWebhookServer({ host: webhookHost, port, path: webhookPath });
        console.error(`[@myclaw/core] Feishu bot "${label}" webhook on http://${webhookHost}:${port}${webhookPath}`);
      } else {
        await app.startWebSocket();
        console.error(`[@myclaw/core] Feishu bot "${label}" WebSocket started`);
      }
    },

    /**
     * Start Feishu bots. Supports multi-bot (admin + girlfriend) or single config.
     * @returns {Promise<{ stop: () => Promise<void> } | null>}
     */
    async registerFeishu() {
      if (!config.channels.feishu) {
        return null;
      }
      const fs = config.feishu;
      const hasAdmin = !!(fs.adminAppId && fs.adminAppSecret);
      const hasGf = !!(fs.girlfriendAppId && fs.girlfriendAppSecret);
      const hasLegacy = !!(fs.appId && fs.appSecret && fs.verificationToken);

      if (!hasAdmin && !hasGf && !hasLegacy) {
        console.error("[@myclaw/core] Feishu skipped: no credentials configured");
        return null;
      }

      if (hasAdmin || hasGf) {
        if (hasAdmin) {
          await this.launchFeishuBot({
            appId: fs.adminAppId,
            appSecret: fs.adminAppSecret,
            verificationToken: fs.verificationToken,
            encryptKey: fs.encryptKey,
          }, "admin");
        }
        if (hasGf) {
          await this.launchFeishuBot({
            appId: fs.girlfriendAppId,
            appSecret: fs.girlfriendAppSecret,
            verificationToken: fs.girlfriendVerificationToken || fs.verificationToken,
            encryptKey: fs.girlfriendEncryptKey || fs.encryptKey,
          }, "girlfriend", { webhookPort: (fs.webhookPort || 3000) + 1 });
        }
      } else {
        await this.launchFeishuBot({
          appId: fs.appId,
          appSecret: fs.appSecret,
          verificationToken: fs.verificationToken,
          encryptKey: fs.encryptKey,
        }, "default");
      }

      return {
        async stop() {
          for (const [label, app] of feishuBots) {
            try {
              app.stopWebSocket();
              await app.stopWebhookServer();
            } catch (e) {
              console.error(`[@myclaw/core] Feishu bot "${label}" stop error:`, e);
            }
          }
          feishuBots.clear();
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
      if (channel === "feishu") {
        for (const [, app] of feishuBots) {
          try {
            await app.client.im.message.create({
              params: { receive_id_type: "chat_id" },
              data: {
                receive_id: chatId,
                msg_type: "text",
                content: JSON.stringify({ text }),
              },
            });
            return;
          } catch {
            /* try next bot */
          }
        }
        throw new Error(`No Feishu bot could send to chat ${chatId}`);
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

      for (const [, app] of feishuBots) {
        for (const chatId of feishuChatIds) {
          try {
            await app.client.im.message.create({
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

    /** @returns {{ telegram: boolean; telegramBotCount: number; feishu: boolean; feishuBotCount: number; telegramChats: number; feishuChats: number }} */
    getChannelStats() {
      return {
        telegram: telegramBots.size > 0,
        telegramBotCount: telegramBots.size,
        feishu: feishuBots.size > 0,
        feishuBotCount: feishuBots.size,
        telegramChats: telegramChatIds.size,
        feishuChats: feishuChatIds.size,
      };
    },
  };
}
