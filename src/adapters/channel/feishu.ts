/**
 * 飞书通道适配器
 *
 * 实现 IChannelAdapter 接口，桥接飞书消息与 Agent 核心循环。
 * 支持两种传输方式：
 *   1. WebSocket（推荐，无需公网 IP）
 *   2. Webhook HTTP Server（需要飞书后台配置回调地址）
 *
 * 依赖 @larksuiteoapi/node-sdk 官方 SDK。
 */

import * as http from 'node:http';
import crypto from 'node:crypto';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { IChannelAdapter, IInboundMessage, IOutboundMessage } from '../../ports/channel.js';
import type { IFeishuBotConfig } from './feishu-config.js';
import type { IFeishuDedup } from './feishu-dedup.js';

export interface IFeishuAdapterOptions {
  config: IFeishuBotConfig;
  /** 传输方式，默认 websocket */
  transport?: 'websocket' | 'webhook';
  /** 通道名称标识（如 "feishu:admin" 或 "feishu:girlfriend"） */
  channelName?: string;
  /** 消息去重实例（可选，启用后自动过滤重复 + 启动补漏） */
  dedup?: IFeishuDedup;
}

function resolveSdkDomain(config: IFeishuBotConfig) {
  return config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

/** 飞书 Webhook 签名验证 */
function verifySignature(
  headers: http.IncomingHttpHeaders,
  rawBody: string,
  encryptKey?: string,
): boolean {
  if (!encryptKey?.trim()) return true;

  const timestamp = headers['x-lark-request-timestamp'] as string | undefined;
  const nonce = headers['x-lark-request-nonce'] as string | undefined;
  const signature = headers['x-lark-signature'] as string | undefined;
  if (!timestamp || !nonce || !signature) return false;

  const computed = crypto
    .createHash('sha256')
    .update(timestamp + nonce + encryptKey + rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 从飞书 post 富文本中提取纯文本 */
function postToPlainText(post: Record<string, unknown>): string {
  const node = isRecord(post.zh_cn) ? post.zh_cn : isRecord(post.en_us) ? post.en_us : null;
  const content = node && Array.isArray(node.content) ? node.content : null;
  if (!content) return '';

  const parts: string[] = [];
  for (const row of content) {
    if (!Array.isArray(row)) continue;
    for (const seg of row) {
      if (isRecord(seg) && seg.tag === 'text' && typeof seg.text === 'string') {
        parts.push(seg.text);
      }
    }
  }
  return parts.join('').trim();
}

function parseJsonContent(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createFeishuAdapter(options: IFeishuAdapterOptions): IChannelAdapter {
  const { config, transport = 'websocket', channelName = 'feishu', dedup } = options;
  let messageHandler: ((msg: IInboundMessage) => Promise<string>) | null = null;

  const client = new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveSdkDomain(config),
  });

  const dispatcher = new Lark.EventDispatcher({
    encryptKey: config.encryptKey || undefined,
    verificationToken: config.verificationToken || undefined,
  });

  let wsClient: Lark.WSClient | null = null;
  let httpServer: http.Server | null = null;

  /** 统一消息处理入口 */
  async function handleTextMessage(
    chatId: string,
    messageId: string,
    openId: string | undefined,
    text: string,
    createTime?: string,
  ) {
    if (!messageHandler || !text) return;

    if (dedup?.isProcessed(messageId)) {
      return;
    }

    const inbound: IInboundMessage = {
      channel: channelName,
      userId: openId ?? chatId,
      text,
      timestamp: new Date(),
      metadata: { chatId, messageId, openId },
    };

    try {
      const reply = await messageHandler(inbound);
      await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text: reply }),
        },
      });
      dedup?.markProcessed(messageId, createTime);
    } catch (err) {
      console.error(`[${channelName}] handleTextMessage error:`, err);
      dedup?.markProcessed(messageId, createTime);
    }
  }

  /** 自动获取 Bot 所在的所有会话 */
  async function discoverChatIds(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const res = await client.im.chat.list({
          params: { page_size: 100, ...(pageToken && { page_token: pageToken }) },
        });
        for (const chat of res?.data?.items ?? []) {
          if (chat.chat_id) ids.push(chat.chat_id);
        }
        pageToken = res?.data?.page_token ?? undefined;
      } while (pageToken);
    } catch (err) {
      console.error(`[${channelName}] 获取会话列表失败:`, err);
    }
    return ids;
  }

  /** 启动补漏：拉取停机期间的未处理消息 */
  async function catchUpMissedMessages(chatIds?: string[]): Promise<number> {
    if (!dedup || !messageHandler) return 0;
    const lastTime = dedup.getLastProcessedTime();
    if (!lastTime) return 0;

    const targetChats = chatIds?.length ? chatIds : await discoverChatIds();
    if (!targetChats.length) return 0;
    console.error(`[${channelName}] 开始补漏: ${targetChats.length} 个会话, 从 ${lastTime} 开始`);

    let caught = 0;
    for (const chatId of targetChats) {
      try {
        const res = await client.im.message.list({
          params: {
            container_id_type: 'chat',
            container_id: chatId,
            start_time: lastTime,
            page_size: 50,
            sort_type: 'ByCreateTimeAsc' as any,
          },
        });
        const items = res?.data?.items ?? [];
        for (const msg of items) {
          const msgId = msg.message_id;
          if (!msgId || dedup.isProcessed(msgId)) continue;
          if (msg.sender?.sender_type === 'app') continue;

          const senderId = msg.sender?.id;
          const contentRaw = msg.body?.content;
          if (!contentRaw) continue;

          let text = '';
          if (msg.msg_type === 'text') {
            const parsed = parseJsonContent(contentRaw);
            text = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
          } else if (msg.msg_type === 'post') {
            const parsed = parseJsonContent(contentRaw);
            text = parsed ? postToPlainText(parsed) : '';
          }
          if (!text || text.startsWith('/')) continue;

          console.error(`[${channelName}] 补漏消息: ${msgId} (${text.slice(0, 30)}...)`);
          await handleTextMessage(chatId, msgId, senderId, text, msg.create_time);
          caught++;
        }
      } catch (err) {
        console.error(`[${channelName}] 补漏拉取失败 (chat=${chatId}):`, err);
      }
    }
    return caught;
  }

  /** 注册飞书事件 */
  dispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      if (!isRecord(data)) return;
      const sender = data.sender;
      const message = data.message;
      if (!isRecord(sender) || !isRecord(message)) return;

      if (str(sender.sender_type) === 'app') return;

      const senderId = isRecord(sender.sender_id) ? sender.sender_id : {};
      const openId = str(senderId.open_id);

      if (config.allowFrom.size > 0 && openId && !config.allowFrom.has(openId)) return;

      const messageId = str(message.message_id);
      const chatId = str(message.chat_id);
      const messageType = str(message.message_type);
      const contentRaw = str(message.content);
      if (!messageId || !chatId || !messageType || !contentRaw) return;

      const createTime = str(message.create_time);

      if (messageType === 'text') {
        const parsed = parseJsonContent(contentRaw);
        const text = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
        if (text && !text.startsWith('/')) {
          await handleTextMessage(chatId, messageId, openId, text, createTime);
        }
        return;
      }

      if (messageType === 'post') {
        const parsed = parseJsonContent(contentRaw);
        const plain = parsed ? postToPlainText(parsed) : '';
        if (plain) {
          await handleTextMessage(chatId, messageId, openId, plain, createTime);
        }
        return;
      }

      if (messageType === 'interactive') {
        let summary = '[interactive card]';
        const parsed = parseJsonContent(contentRaw);
        if (parsed && isRecord(parsed.header)) {
          const title = parsed.header as Record<string, unknown>;
          if (isRecord(title.title) && typeof (title.title as Record<string, unknown>).content === 'string') {
            summary = `[card] ${(title.title as Record<string, unknown>).content}`;
          }
        }
        await handleTextMessage(chatId, messageId, openId, summary, createTime);
      }
    },
  });

  /** Webhook HTTP 服务器 */
  async function startWebhook(): Promise<void> {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== config.webhookPath) {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void (async () => {
          try {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            if (!verifySignature(req.headers, rawBody, config.encryptKey)) {
              res.statusCode = 401;
              res.end('Invalid signature');
              return;
            }

            let payload: unknown;
            try {
              payload = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              res.end('Invalid JSON');
              return;
            }
            if (!isRecord(payload)) {
              res.statusCode = 400;
              res.end('Invalid payload');
              return;
            }

            const { isChallenge, challenge } = Lark.generateChallenge(payload, {
              encryptKey: config.encryptKey || '',
            });
            if (isChallenge) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(challenge));
              return;
            }

            const envelope = Object.assign(Object.create({ headers: req.headers }), payload);
            const value = await dispatcher.invoke(envelope, { needCheck: false });
            if (!res.headersSent) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(value ?? {}));
            }
          } catch (err) {
            console.error(`[${channelName}] webhook error:`, err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end('Internal Server Error');
            }
          }
        })();
      });
    });

    httpServer = server;
    const { createRequire } = await import('node:module');
    const { resolve: resolvePath, dirname } = await import('node:path');
    const _req = createRequire(import.meta.url);
    const sdkPath = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'SOTAgent', 'sdk-port', 'index.js');
    const { claimPort, registerCapabilities } = _req(sdkPath);
    const port = await claimPort({ service: `myclaw-feishu-${channelName}`, project: 'MyClaw', preferred: config.webhookPort });

    const capPath = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'MyClaw', 'capabilities.json');
    registerCapabilities(capPath).catch((e: unknown) => console.warn('[MyClaw] capability registration failed (non-fatal):', e));

    await new Promise<void>((resolve, reject) => {
      server.listen(port, config.webhookHost, () => resolve());
      server.once('error', reject);
    });
    console.error(`[${channelName}] webhook server listening on ${config.webhookHost}:${port}${config.webhookPath}`);
  }

  /** WebSocket 长连接 */
  async function startWs(): Promise<void> {
    wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: resolveSdkDomain(config),
      loggerLevel: Lark.LoggerLevel.info,
    });
    await wsClient.start({ eventDispatcher: dispatcher });
    console.error(`[${channelName}] WebSocket connected`);
  }

  return {
    name: channelName,

    async start() {
      if (transport === 'webhook') {
        await startWebhook();
      } else {
        await startWs();
      }
    },

    async catchUp(chatIds?: string[]) {
      const caught = await catchUpMissedMessages(chatIds);
      if (caught > 0) {
        console.error(`[${channelName}] 启动补漏完成: 处理了 ${caught} 条遗漏消息`);
      }
      dedup?.flush();
    },

    async stop() {
      dedup?.flush();
      if (wsClient) {
        try { wsClient.close(); } catch { /* ignore */ }
        wsClient = null;
      }
      if (httpServer) {
        await new Promise<void>(resolve => {
          httpServer!.close(() => resolve());
        });
        httpServer = null;
      }
    },

    async send(message: IOutboundMessage) {
      const res = await client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: message.userId,
          msg_type: message.card ? 'interactive' : 'text',
          content: message.card
            ? JSON.stringify(message.card)
            : JSON.stringify({ text: message.text }),
        },
      });
      if (isRecord(res) && res.code !== undefined && res.code !== 0) {
        throw new Error(`Feishu send failed: ${res.msg} (code ${res.code})`);
      }
    },

    onMessage(handler) {
      messageHandler = handler;
    },
  };
}
