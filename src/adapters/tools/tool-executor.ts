import type { IToolExecutor, IToolHandler } from '../../ports/tools.js';
import type { IToolDefinition } from '../../ports/llm.js';

export interface IToolExecutorConfig {
  beforeExecute?: (name: string, args: Record<string, unknown>) => Promise<void>;
  timeoutMs?: number;
  maxOutputLength?: number;
}

export function createToolExecutor(config: IToolExecutorConfig = {}): IToolExecutor {
  const tools = new Map<string, IToolHandler>();
  const { beforeExecute, timeoutMs = 30000, maxOutputLength = 50000 } = config;

  return {
    register(tool) {
      tools.set(tool.name, tool);
    },

    unregister(name) {
      return tools.delete(name);
    },

    async execute(name, args) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`未注册的工具: ${name}`);

      if (beforeExecute) await beforeExecute(name, args);

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve(tool.handler(args)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`工具 ${name} 执行超时 (${timeoutMs}ms)`)),
              timeoutMs,
            );
          }),
        ]);
        clearTimeout(timer);

        if (maxOutputLength && typeof result === 'string' && result.length > maxOutputLength) {
          console.error(`[ToolExecutor] ${name}: output truncated ${result.length} → ${maxOutputLength}`);
          return result.slice(0, maxOutputLength) + `\n...(truncated, original ${result.length} chars)`;
        }

        return result;
      } catch (err) {
        clearTimeout(timer);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ToolExecutor] ${name} failed: ${errMsg}`);
        throw err;
      }
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
