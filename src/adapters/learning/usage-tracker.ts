/**
 * Usage Tracker — 工具执行代理层
 *
 * 包装 IToolExecutor，在每次工具调用时自动记录使用记录到 LearningStore。
 * 不改变原有工具执行逻辑，纯观察者模式。
 */

import type { IToolExecutor, IToolHandler } from '../../ports/tools.js';
import type { ILearningStore } from '../../ports/learning.js';
import type { IToolDefinition } from '../../ports/llm.js';

export interface ITrackedToolExecutor extends IToolExecutor {
  /** 设置当前上下文（用于记录 userId / conversationId） */
  setContext(userId: string, conversationId: string): void;
}

export function createTrackedToolExecutor(
  inner: IToolExecutor,
  learningStore: ILearningStore,
): ITrackedToolExecutor {
  let currentUserId = 'anonymous';
  let currentConvId = 'unknown';

  return {
    register(tool: IToolHandler) {
      inner.register(tool);
    },

    unregister(name: string) {
      return inner.unregister(name);
    },

    async execute(name: string, args: Record<string, unknown>) {
      const start = Date.now();
      let success = true;
      let result: unknown;

      try {
        result = await inner.execute(name, args);
      } catch (err) {
        success = false;
        result = { error: err instanceof Error ? err.message : String(err) };
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        try {
          let resultStr: string;
          try { resultStr = JSON.stringify(result); } catch { resultStr = String(result); }

          learningStore.recordUsage({
            conversationId: currentConvId,
            userId: currentUserId,
            toolName: name,
            args: JSON.stringify(args),
            result: resultStr,
            success,
            durationMs,
          });
        } catch {
          // recording failure is non-critical
        }
      }

      return result;
    },

    list(): IToolDefinition[] {
      return inner.list();
    },

    has(name: string) {
      return inner.has(name);
    },

    setContext(userId: string, conversationId: string) {
      currentUserId = userId;
      currentConvId = conversationId;
    },
  };
}
