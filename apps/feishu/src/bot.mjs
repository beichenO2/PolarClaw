/**
 * Feishu / Lark bot: Client + EventDispatcher + WebSocket / Webhook transports.
 * Bridges mirror apps/telegram: onUserMessage(ctx, text), onUserDocument(ctx, meta).
 */

import * as http from "node:http";
import crypto from "node:crypto";
import * as Lark from "@larksuiteoapi/node-sdk";
import { buildTaskCard } from "./cards.mjs";

/**
 * @typedef {import('./config.mjs').FeishuBotConfig} FeishuBotConfig
 */

/**
 * @typedef {object} FeishuUserDocumentMeta
 * @property {string} fileKey
 * @property {string} messageId
 * @property {string} fileName
 * @property {string} [mimeType]
 * @property {"file" | "image"} resourceType
 */

/**
 * @typedef {object} FeishuMessageContext
 * @property {Lark.Client} client
 * @property {string} messageId
 * @property {string} chatId
 * @property {string} [openId]
 * @property {unknown} rawEvent
 * @property {(text: string) => Promise<void>} replyText
 * @property {(card: Record<string, unknown>) => Promise<void>} replyInteractive
 * @property {(meta: FeishuUserDocumentMeta) => Promise<Buffer>} downloadResource
 */

/**
 * @typedef {object} FeishuCardActionContext
 * @property {Lark.Client} client
 * @property {string} chatId
 * @property {string} [openId]
 * @property {unknown} rawEvent
 * @property {(text: string) => Promise<void>} replyText
 */

/**
 * @typedef {object} FeishuBridges
 * @property {(ctx: FeishuMessageContext, text: string) => Promise<void> | void} onUserMessage
 * @property {(ctx: FeishuMessageContext, meta: FeishuUserDocumentMeta) => Promise<void> | void} onUserDocument
 */

const TEXT_CMD_PREFIX = "/";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * @param {FeishuBotConfig} config
 */
function resolveSdkDomain(config) {
  if (config.domain === "lark") {
    return Lark.Domain.Lark;
  }
  return Lark.Domain.Feishu;
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * @param {{ headers: http.IncomingHttpHeaders; rawBody: string; encryptKey?: string }} params
 */
function isFeishuWebhookSignatureValid(params) {
  const encryptKey = params.encryptKey?.trim();
  if (!encryptKey) {
    return true;
  }
  const timestampHeader = params.headers["x-lark-request-timestamp"];
  const nonceHeader = params.headers["x-lark-request-nonce"];
  const signatureHeader = params.headers["x-lark-signature"];
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!timestamp || !nonce || !signature) {
    return false;
  }
  const computed = crypto
    .createHash("sha256")
    .update(timestamp + nonce + encryptKey + params.rawBody)
    .digest("hex");
  return safeEqualHex(computed, signature);
}

/**
 * @param {unknown} response
 * @param {string} label
 */
function assertImMessageOk(response, label) {
  if (!isRecord(response)) {
    throw new Error(`${label}: empty response`);
  }
  const code = response.code;
  if (code !== undefined && code !== 0) {
    const msg = typeof response.msg === "string" ? response.msg : "unknown error";
    throw new Error(`${label}: ${msg} (code ${code})`);
  }
}

/**
 * @param {Lark.Client} client
 * @param {unknown} rawEvent
 */
function createMessageContext(client, rawEvent) {
  if (!isRecord(rawEvent)) {
    throw new Error("Invalid Feishu message event");
  }
  const message = rawEvent.message;
  const sender = rawEvent.sender;
  if (!isRecord(message) || !isRecord(sender)) {
    throw new Error("Invalid Feishu message event shape");
  }
  const messageId = readString(message.message_id);
  const chatId = readString(message.chat_id);
  if (!messageId || !chatId) {
    throw new Error("Missing message_id or chat_id");
  }
  const senderId = isRecord(sender.sender_id) ? sender.sender_id : {};
  const openId = readString(senderId.open_id);

  return {
    client,
    messageId,
    chatId,
    openId,
    rawEvent,
    async replyText(text) {
      const res = await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
      assertImMessageOk(res, "Feishu reply");
    },
    async replyInteractive(card) {
      const content = JSON.stringify(card);
      const res = await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: "interactive",
          content,
        },
      });
      assertImMessageOk(res, "Feishu interactive reply");
    },
    async downloadResource(meta) {
      const res = await client.im.messageResource.get({
        path: { message_id: meta.messageId, file_key: meta.fileKey },
        params: { type: meta.resourceType },
      });
      const stream = res.getReadableStream();
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}

/**
 * @param {Lark.Client} client
 * @param {unknown} rawEvent
 */
function createCardActionContext(client, rawEvent) {
  if (!isRecord(rawEvent)) {
    throw new Error("Invalid card action event");
  }
  const operator = rawEvent.operator;
  const context = rawEvent.context;
  if (!isRecord(operator) || !isRecord(context)) {
    throw new Error("Invalid card action event shape");
  }
  const chatId = readString(context.chat_id);
  if (!chatId) {
    throw new Error("Missing chat_id on card action");
  }
  const openId = readString(operator.open_id);

  return {
    client,
    chatId,
    openId,
    rawEvent,
    async replyText(text) {
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
      assertImMessageOk(res, "Feishu card-action reply");
    },
  };
}

/**
 * Shape-compatible with {@link FeishuMessageContext} for bridges that only use reply* helpers.
 * @param {Lark.Client} client
 * @param {ReturnType<typeof createCardActionContext>} cardCtx
 * @returns {FeishuMessageContext}
 */
function cardActionToMessageContext(client, cardCtx) {
  return {
    client,
    messageId: "",
    chatId: cardCtx.chatId,
    openId: cardCtx.openId,
    rawEvent: cardCtx.rawEvent,
    replyText: cardCtx.replyText,
    async replyInteractive(card) {
      const content = JSON.stringify(card);
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: cardCtx.chatId,
          msg_type: "interactive",
          content,
        },
      });
      assertImMessageOk(res, "Feishu card-action interactive reply");
    },
    async downloadResource() {
      throw new Error("downloadResource is not available for card.action context");
    },
  };
}

/**
 * @param {string} contentJson
 */
function parseJsonContent(contentJson) {
  try {
    const parsed = JSON.parse(contentJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort plain text from a Feishu "post" rich-text payload.
 * @param {Record<string, unknown>} post
 */
function postToPlainText(post) {
  const zh = post.zh_cn;
  const en = post.en_us;
  const node = isRecord(zh) ? zh : isRecord(en) ? en : null;
  const content = node && Array.isArray(node.content) ? node.content : null;
  if (!content) {
    return "";
  }
  const parts = [];
  for (const row of content) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const seg of row) {
      if (!isRecord(seg)) {
        continue;
      }
      if (seg.tag === "text" && typeof seg.text === "string") {
        parts.push(seg.text);
      }
    }
  }
  return parts.join("").trim();
}

/**
 * @param {FeishuBotConfig} config
 * @param {FeishuBridges} bridges
 */
export function createFeishuBot(config, bridges) {
  if (!bridges || typeof bridges.onUserMessage !== "function") {
    throw new Error("bridges.onUserMessage is required");
  }
  if (typeof bridges.onUserDocument !== "function") {
    throw new Error("bridges.onUserDocument is required");
  }

  const client = new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveSdkDomain(config),
  });

  const eventDispatcher = new Lark.EventDispatcher({
    encryptKey: config.encryptKey || undefined,
    verificationToken: config.verificationToken || undefined,
  });

  /** @type {Lark.WSClient | null} */
  let wsClient = null;
  /** @type {http.Server | null} */
  let httpServer = null;

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      try {
        if (!isRecord(data)) {
          return;
        }
        const sender = data.sender;
        const message = data.message;
        if (!isRecord(sender) || !isRecord(message)) {
          return;
        }
        if (readString(sender.sender_type) === "app") {
          return;
        }
        const openId = isRecord(sender.sender_id)
          ? readString(sender.sender_id.open_id)
          : undefined;
        if (config.allowFrom.size > 0 && openId && !config.allowFrom.has(openId)) {
          return;
        }

        const messageId = readString(message.message_id);
        const chatId = readString(message.chat_id);
        const messageType = readString(message.message_type);
        const contentRaw = readString(message.content);
        if (!messageId || !chatId || !messageType || !contentRaw) {
          return;
        }

        const ctx = createMessageContext(client, data);

        if (messageType === "text") {
          const parsed = parseJsonContent(contentRaw);
          const text = parsed && typeof parsed.text === "string" ? parsed.text.trim() : "";
          if (!text || text.startsWith(TEXT_CMD_PREFIX)) {
            return;
          }
          await bridges.onUserMessage(ctx, text);
          return;
        }

        if (messageType === "post") {
          const parsed = parseJsonContent(contentRaw);
          const plain =
            parsed && isRecord(parsed) ? postToPlainText(/** @type {Record<string, unknown>} */ (parsed)) : "";
          if (plain) {
            await bridges.onUserMessage(ctx, plain);
          }
          return;
        }

        if (messageType === "file") {
          const parsed = parseJsonContent(contentRaw);
          const fileKey =
            parsed && typeof parsed.file_key === "string" ? parsed.file_key.trim() : "";
          const fileName =
            parsed && typeof parsed.file_name === "string"
              ? parsed.file_name.trim()
              : "attachment";
          if (!fileKey) {
            return;
          }
          await bridges.onUserDocument(ctx, {
            fileKey,
            messageId,
            fileName,
            mimeType: undefined,
            resourceType: "file",
          });
          return;
        }

        if (messageType === "image") {
          const parsed = parseJsonContent(contentRaw);
          const imageKey =
            parsed && typeof parsed.image_key === "string" ? parsed.image_key.trim() : "";
          if (!imageKey) {
            return;
          }
          await bridges.onUserDocument(ctx, {
            fileKey: imageKey,
            messageId,
            fileName: "image.bin",
            mimeType: "application/octet-stream",
            resourceType: "image",
          });
          return;
        }

        if (messageType === "interactive") {
          let summary = "[interactive card]";
          const parsed = parseJsonContent(contentRaw);
          if (parsed && isRecord(parsed)) {
            const header = parsed.header;
            if (isRecord(header)) {
              const title = header.title;
              if (isRecord(title) && typeof title.content === "string") {
                summary = `[card] ${title.content}`;
              }
            }
          }
          await bridges.onUserMessage(ctx, summary);
        }
      } catch (err) {
        console.error("[@myclaw/feishu] im.message.receive_v1:", err);
      }
    },

    "card.action.trigger": async (data) => {
      try {
        if (!isRecord(data)) {
          return { toast: { type: "info", content: { tag: "plain_text", content: "ok" } } };
        }
        const action = data.action;
        const value =
          isRecord(action) && action.value !== undefined
            ? JSON.stringify(action.value)
            : "{}";
        const cardCtx = createCardActionContext(client, data);
        const ctx = cardActionToMessageContext(client, cardCtx);
        await bridges.onUserMessage(ctx, `[card action] ${value}`);
        return { toast: { type: "success", content: { tag: "plain_text", content: "已收到" } } };
      } catch (err) {
        console.error("[@myclaw/feishu] card.action.trigger:", err);
        return { toast: { type: "error", content: { tag: "plain_text", content: "处理失败" } } };
      }
    },
  });

  return {
    client,
    eventDispatcher,

    /**
     * Long polling alternative: Feishu WebSocket client (recommended for small bots).
     * @returns {Promise<Lark.WSClient>}
     */
    async startWebSocket() {
      if (wsClient) {
        throw new Error("WebSocket client already started");
      }
      wsClient = new Lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: resolveSdkDomain(config),
        loggerLevel: Lark.LoggerLevel.info,
      });
      await wsClient.start({ eventDispatcher });
      return wsClient;
    },

    /**
     * Stop WebSocket client if running.
     */
    stopWebSocket() {
      if (wsClient) {
        try {
          wsClient.close();
        } catch {
          /* ignore */
        }
        wsClient = null;
      }
    },

    /**
     * HTTP webhook server (configure request URL in Feishu developer console).
     * @param {{ host?: string; port?: number; path?: string } | undefined} overrides
     * @returns {Promise<http.Server>}
     */
    async startWebhookServer(overrides) {
      if (httpServer) {
        throw new Error("Webhook server already started");
      }
      const host = overrides?.host ?? config.webhookHost;
      const port = overrides?.port ?? config.webhookPort;
      const path = overrides?.path ?? config.webhookPath;

      const server = http.createServer((req, res) => {
        if (req.method !== "POST" || req.url !== path) {
          res.statusCode = 404;
          res.end();
          return;
        }

        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          void (async () => {
            try {
              const rawBody = Buffer.concat(chunks).toString("utf8");
              if (!isFeishuWebhookSignatureValid({ headers: req.headers, rawBody, encryptKey: config.encryptKey })) {
                res.statusCode = 401;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end("Invalid signature");
                return;
              }

              let payload;
              try {
                payload = JSON.parse(rawBody);
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end("Invalid JSON");
                return;
              }
              if (!isRecord(payload)) {
                res.statusCode = 400;
                res.end("Invalid payload");
                return;
              }

              const { isChallenge, challenge } = Lark.generateChallenge(payload, {
                encryptKey: config.encryptKey || "",
              });
              if (isChallenge) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(challenge));
                return;
              }

              const envelope = Object.assign(Object.create({ headers: req.headers }), payload);
              const value = await eventDispatcher.invoke(envelope, { needCheck: false });
              if (!res.headersSent) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(value ?? {}));
              }
            } catch (err) {
              console.error("[@myclaw/feishu] webhook:", err);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end("Internal Server Error");
              }
            }
          })();
        });
      });

      httpServer = server;
      await new Promise((resolve, reject) => {
        server.listen(port, host, () => resolve(undefined));
        server.once("error", reject);
      });
      return server;
    },

    /**
     * Stop webhook HTTP server if running.
     * @returns {Promise<void>}
     */
    stopWebhookServer() {
      return new Promise((resolve) => {
        if (!httpServer) {
          resolve();
          return;
        }
        httpServer.close(() => {
          httpServer = null;
          resolve();
        });
      });
    },

    /**
     * Send a task status card (interactive message).
     * @param {{
     *   receiveId: string;
     *   receiveIdType: "chat_id" | "open_id" | "union_id" | "user_id" | "email";
     *   task: Parameters<typeof buildTaskCard>[0];
     *   replyToMessageId?: string;
     * }} params
     */
    async sendTaskNotification(params) {
      const card = buildTaskCard(params.task);
      const content = JSON.stringify(card);
      if (params.replyToMessageId) {
        const res = await client.im.message.reply({
          path: { message_id: params.replyToMessageId },
          data: { msg_type: "interactive", content },
        });
        assertImMessageOk(res, "Feishu sendTaskNotification (reply)");
        return res;
      }
      const res = await client.im.message.create({
        params: { receive_id_type: params.receiveIdType },
        data: {
          receive_id: params.receiveId,
          msg_type: "interactive",
          content,
        },
      });
      assertImMessageOk(res, "Feishu sendTaskNotification");
      return res;
    },

    /**
     * Send arbitrary interactive card JSON.
     * @param {{
     *   receiveId: string;
     *   receiveIdType: "chat_id" | "open_id" | "union_id" | "user_id" | "email";
     *   card: Record<string, unknown>;
     *   replyToMessageId?: string;
     * }} params
     */
    async sendInteractiveCard(params) {
      const content = JSON.stringify(params.card);
      if (params.replyToMessageId) {
        const res = await client.im.message.reply({
          path: { message_id: params.replyToMessageId },
          data: { msg_type: "interactive", content },
        });
        assertImMessageOk(res, "Feishu sendInteractiveCard (reply)");
        return res;
      }
      const res = await client.im.message.create({
        params: { receive_id_type: params.receiveIdType },
        data: {
          receive_id: params.receiveId,
          msg_type: "interactive",
          content,
        },
      });
      assertImMessageOk(res, "Feishu sendInteractiveCard");
      return res;
    },
  };
}
