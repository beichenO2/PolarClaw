/**
 * CLI 通道适配器 — 终端交互式对话
 *
 * 实现 IChannelAdapter 接口。
 * 通过 stdin/stdout 与用户交互，适用于本地开发测试。
 */

import * as readline from 'node:readline';
import type { IChannelAdapter, IInboundMessage, IOutboundMessage } from '../../ports/channel.js';

export interface ICLIAdapterOptions {
  channelName?: string;
  userId?: string;
  prompt?: string;
}

export function createCLIAdapter(options: ICLIAdapterOptions = {}): IChannelAdapter {
  const { channelName = 'cli', userId = 'cli-user', prompt = '你> ' } = options;
  let messageHandler: ((msg: IInboundMessage) => Promise<string>) | null = null;
  let rl: readline.Interface | null = null;
  let running = false;

  return {
    name: channelName,

    async start() {
      if (running) return;
      running = true;

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: process.stdin.isTTY === true,
      });

      console.log('');
      console.log('╭──────────────────────────────────────╮');
      console.log('│   MyClaw CLI — 输入消息开始对话      │');
      console.log('│   输入 /quit 退出                    │');
      console.log('╰──────────────────────────────────────╯');
      console.log('');

      rl.on('close', () => {
        running = false;
      });

      const askNext = () => {
        if (!running || !rl) return;
        try {
          rl.question(prompt, async (input) => {
            const text = input.trim();

            if (!text) {
              askNext();
              return;
            }

            if (text === '/quit' || text === '/exit' || text === '/q') {
              console.log('\n再见 👋');
              running = false;
              rl?.close();
              process.exit(0);
              return;
            }

            if (!messageHandler) {
              console.log('[MyClaw] 未注册消息处理器');
              askNext();
              return;
            }

            const inbound: IInboundMessage = {
              channel: channelName,
              userId,
              text,
              timestamp: new Date(),
            };

            try {
              const reply = await messageHandler(inbound);
              console.log(`\nMyClaw> ${reply}\n`);
            } catch (err) {
              console.error(`\n[Error] ${err instanceof Error ? err.message : String(err)}\n`);
            }

            askNext();
          });
        } catch {
          running = false;
        }
      };

      askNext();
    },

    async stop() {
      running = false;
      rl?.close();
      rl = null;
    },

    async send(message: IOutboundMessage) {
      console.log(`\nMyClaw> ${message.text}\n`);
    },

    onMessage(handler) {
      messageHandler = handler;
    },
  };
}
