/**
 * RetryLoop 智能路由 — 检测用户是否显式要求 RetryLoop
 *
 * 触发条件：用户消息包含 "RetryLoop" + 数字 + "次/循环/遍/轮"
 * 排除条件："解释/什么是/介绍 RetryLoop" → 视为讨论，不触发
 *
 * 触发后应向用户澄清停止条件，确认后进入 YOLO + RetryLoop 执行。
 */

export interface IRetryLoopDetection {
  triggered: boolean;
  count: number | null;
  isDiscussion: boolean;
  rawMatch: string | null;
}

const TRIGGER_RE = /retryloop\s*(\d+)\s*[次循环遍轮]/i;
const TRIGGER_ALT_RE = /(?:给我|来|跑|执行|进入|开始)\s*retryloop\s*(\d+)/i;
const COUNT_ONLY_RE = /retryloop\s+(\d+)/i;

const DISCUSSION_RE = /(?:解释|什么是|介绍|说说|讲讲|告诉我|是什么意思)\s*(?:一下\s*)?retryloop/i;
const DISCUSSION_RE2 = /retryloop\s*(?:是什么|是啥|什么意思|怎么理解)/i;

export function detectRetryLoop(text: string): IRetryLoopDetection {
  if (DISCUSSION_RE.test(text) || DISCUSSION_RE2.test(text)) {
    return { triggered: false, count: null, isDiscussion: true, rawMatch: null };
  }

  let match = text.match(TRIGGER_RE);
  if (match) {
    return {
      triggered: true,
      count: parseInt(match[1]!, 10),
      isDiscussion: false,
      rawMatch: match[0],
    };
  }

  match = text.match(TRIGGER_ALT_RE);
  if (match) {
    return {
      triggered: true,
      count: parseInt(match[1]!, 10),
      isDiscussion: false,
      rawMatch: match[0],
    };
  }

  match = text.match(COUNT_ONLY_RE);
  if (match) {
    return {
      triggered: true,
      count: parseInt(match[1]!, 10),
      isDiscussion: false,
      rawMatch: match[0],
    };
  }

  return { triggered: false, count: null, isDiscussion: false, rawMatch: null };
}

/**
 * 生成停止条件确认消息。
 * Agent 检测到 RetryLoop 后应发这段话给用户。
 */
export function buildRetryLoopClarification(count: number): string {
  return [
    `检测到你要求 **RetryLoop ${count} 次**。`,
    '',
    '进入 RetryLoop 前需要确认：',
    `1. **执行内容**：你希望我反复执行什么任务？（简要描述）`,
    `2. **停止条件**：什么情况下可以提前停止？（例如：测试全部通过、编译无错误、某个指标达标）`,
    `3. **确认**：确认后将进入 YOLO 模式 + ${count} 轮 RetryLoop`,
    '',
    '请回复以上信息，或直接说"确认"使用默认停止条件（全部轮次跑完）。',
  ].join('\n');
}
