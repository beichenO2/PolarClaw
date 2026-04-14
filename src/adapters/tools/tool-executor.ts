/**
 * 工具执行器适配器
 *
 * 实现 IToolExecutor 接口。
 * 支持工具注册、安全检查、超时控制。
 */

import type { IToolExecutor, IToolHandler } from '../../ports/tools.js';
import type { IToolDefinition } from '../../ports/llm.js';

export interface IToolExecutorConfig {
  /** 执行前钩子（安全检查等） */
  beforeExecute?: (name: string, args: Record<string, unknown>) => Promise<void>;
  /** 单个工具执行超时 ms */
  timeoutMs?: number;
  /** 工具输出最大长度（截断） */
  maxOutputLength?: number;
}

export function createToolExecutor(config: IToolExecutorConfig = {}): IToolExecutor {
  const tools = new Map<string, IToolHandler>();
  const { beforeExecute, timeoutMs = 30000 } = config;

  return {
    register(tool) {
      tools.set(tool.name, tool);
    },

    async execute(name, args) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`未注册的工具: ${name}`);

      if (beforeExecute) await beforeExecute(name, args);

      const result = await Promise.race([
        Promise.resolve(tool.handler(args)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`工具 ${name} 执行超时 (${timeoutMs}ms)`)), timeoutMs)
        ),
      ]);

      return result;
    },

    list() {
      const defs: IToolDefinition[] = [];
      for (const tool of tools.values()) {
        defs.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        });
      }
      return defs;
    },

    has(name) {
      return tools.has(name);
    },
  };
}
