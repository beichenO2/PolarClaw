/**
 * YOLO 自主执行引擎适配器
 *
 * 实现 IYoloEngine 接口。
 * 外层循环驱动 Agent 核心多次执行，直到目标达成或预算耗尽。
 * 每步通过 Agent.handleMessage 注入续行 prompt，不修改 Agent 内部逻辑。
 */

import type {
  IYoloEngine,
  IYoloSessionState,
  IStepResult,
  IRecoveryStrategy,
} from '../../ports/autonomous.js';

export interface IYoloAgentHandle {
  handleMessage(
    channel: string,
    userId: string,
    text: string,
    conversationId?: string,
  ): Promise<{ text: string; blocked: boolean; usage?: { totalTokens: number } }>;
}

export interface IYoloEngineDeps {
  agent: IYoloAgentHandle;
  recovery: IRecoveryStrategy;
  /** 步骤完成时的回调（可选，用于实时通知通道） */
  onStepComplete?: (step: IStepResult, session: IYoloSessionState) => void;
  /** 需要用户介入时的回调 */
  onEscalate?: (sessionId: string, message: string) => void;
}

const GOAL_REACHED_SIGNALS = [
  '目标已完成',
  '任务完成',
  'goal reached',
  'task completed',
  '已全部完成',
  '所有步骤完成',
  '已完成目标',
  'all done',
  'mission accomplished',
  '顺利完成',
  '执行完毕',
  'successfully completed',
];

/** Short responses with completion signals are high-confidence; long text with incidental mentions are not. */
function detectGoalReached(text: string): boolean {
  const lower = text.toLowerCase();
  const matched = GOAL_REACHED_SIGNALS.filter(s => lower.includes(s.toLowerCase()));
  if (matched.length === 0) return false;

  const SHORT_THRESHOLD = 300;
  if (text.length <= SHORT_THRESHOLD) return true;

  const lastSignalIdx = Math.max(
    ...matched.map(s => lower.lastIndexOf(s.toLowerCase())),
  );
  const tail = text.length - lastSignalIdx;
  return tail < SHORT_THRESHOLD;
}

function generateSessionId(): string {
  return `yolo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createYoloEngine(deps: IYoloEngineDeps): IYoloEngine {
  const sessions = new Map<string, IYoloSessionState>();
  const cancelTokens = new Set<string>();

  function buildAlignmentPrompt(goal: string): string {
    return [
      `[YOLO 对齐验证] 目标: ${goal}`,
      '',
      '在开始自主执行之前，请先确认你对目标的理解：',
      '1. 用一句话复述目标的核心要求',
      '2. 列出你计划执行的关键步骤（编号列表）',
      '3. 指出可能的风险或需要用户确认的前置条件',
      '',
      '以"对齐确认："开头回复你的理解。',
    ].join('\n');
  }

  const ALIGNMENT_SIGNALS = ['对齐确认', '目标理解', '计划如下', '步骤如下', '执行计划'];

  function verifyAlignment(text: string): boolean {
    const lower = text.toLowerCase();
    return ALIGNMENT_SIGNALS.some(s => lower.includes(s)) || text.includes('1.') || text.includes('1、');
  }

  function buildStepPrompt(goal: string, step: number, prevResult?: IStepResult): string {
    if (step === 1) {
      return [
        `[YOLO 自主模式] 目标: ${goal}`,
        '',
        '对齐验证已通过。现在开始自主执行第一步。',
        '每步执行完后报告进展。当所有步骤完成时，明确说"目标已完成"。',
        '如果遇到需要用户决策的问题，说"需要用户确认"并描述问题。',
      ].join('\n');
    }

    const lines = [
      `[YOLO 续行 - 步骤 ${step}]`,
      `目标: ${goal}`,
    ];

    if (prevResult?.error) {
      lines.push(`上一步出错: ${prevResult.error}`, '请尝试其他方式继续。');
    } else if (prevResult) {
      lines.push('上一步已完成，请继续执行下一步。如果目标已达成，请说"目标已完成"。');
    }

    return lines.join('\n');
  }

  return {
    async run(config, context) {
      const sessionId = generateSessionId();
      const session: IYoloSessionState = {
        sessionId,
        status: 'running',
        stepsCompleted: 0,
        totalTokensUsed: 0,
        elapsedMs: 0,
        steps: [],
      };
      sessions.set(sessionId, session);

      const startTime = Date.now();
      const convId = context.conversationId ?? `yolo:${context.userId}:${sessionId}`;

      // Step 0: Intent alignment verification
      try {
        const alignPrompt = buildAlignmentPrompt(config.goal);
        const alignResponse = await deps.agent.handleMessage(
          context.channel, context.userId, alignPrompt, convId,
        );
        const alignTokens = alignResponse.usage?.totalTokens ?? 0;
        session.totalTokensUsed += alignTokens;

        if (!verifyAlignment(alignResponse.text)) {
          session.status = 'escalated';
          session.stopReason = '对齐验证未通过：Agent 可能未正确理解目标';
          session.elapsedMs = Date.now() - startTime;
          session.steps.push({
            step: 0, text: alignResponse.text, tokensUsed: alignTokens,
            goalReached: false, error: '对齐验证未通过', durationMs: Date.now() - startTime,
          });
          deps.onEscalate?.(sessionId, `对齐验证未通过，Agent 回复: ${alignResponse.text.slice(0, 200)}`);
          return session;
        }

        session.steps.push({
          step: 0, text: alignResponse.text, tokensUsed: alignTokens,
          goalReached: false, durationMs: Date.now() - startTime,
        });
        deps.onStepComplete?.({ step: 0, text: '对齐验证通过', tokensUsed: alignTokens, goalReached: false, durationMs: Date.now() - startTime }, session);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        session.status = 'aborted';
        session.stopReason = `对齐验证失败: ${msg}`;
        session.elapsedMs = Date.now() - startTime;
        return session;
      }

      let prevResult: IStepResult | undefined;

      for (let step = 1; step <= config.maxSteps; step++) {
        if (cancelTokens.has(sessionId)) {
          session.status = 'aborted';
          session.stopReason = '用户取消';
          break;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed > config.maxWallTimeMs) {
          session.status = 'aborted';
          session.stopReason = `超时 (${Math.round(elapsed / 1000)}s)`;
          break;
        }

        if (session.totalTokensUsed >= config.maxTotalTokens) {
          session.status = 'aborted';
          session.stopReason = `Token 预算耗尽 (${session.totalTokensUsed}/${config.maxTotalTokens})`;
          break;
        }

        const prompt = buildStepPrompt(config.goal, step, prevResult);
        const stepStart = Date.now();
        let retriesSoFar = 0;
        let stepResult: IStepResult | null = null;

        while (retriesSoFar <= config.maxRetries) {
          try {
            const response = await deps.agent.handleMessage(
              context.channel,
              context.userId,
              prompt,
              convId,
            );

            const tokensUsed = response.usage?.totalTokens ?? 0;
            stepResult = {
              step,
              text: response.text,
              tokensUsed,
              goalReached: detectGoalReached(response.text),
              durationMs: Date.now() - stepStart,
            };
            break;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const action = deps.recovery.decide(error, {
              step,
              retriesSoFar,
              maxRetries: config.maxRetries,
              goal: config.goal,
            });

            switch (action.type) {
              case 'retry':
                retriesSoFar++;
                await sleep(Math.min(1000 * 2 ** retriesSoFar, 30000));
                continue;

              case 'skip':
                stepResult = {
                  step,
                  text: action.reason,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.reason,
                  durationMs: Date.now() - stepStart,
                };
                break;

              case 'escalate':
                session.status = 'escalated';
                session.stopReason = action.message;
                deps.onEscalate?.(sessionId, action.message);
                stepResult = {
                  step,
                  text: action.message,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.message,
                  durationMs: Date.now() - stepStart,
                };
                break;

              case 'abort':
                session.status = 'aborted';
                session.stopReason = action.reason;
                stepResult = {
                  step,
                  text: action.reason,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.reason,
                  durationMs: Date.now() - stepStart,
                };
                break;
            }
            break;
          }
        }

        if (stepResult) {
          session.steps.push(stepResult);
          session.stepsCompleted = step;
          session.totalTokensUsed += stepResult.tokensUsed;
          session.elapsedMs = Date.now() - startTime;
          prevResult = stepResult;
          deps.onStepComplete?.(stepResult, session);

          if (stepResult.goalReached) {
            session.status = 'completed';
            break;
          }

          if (stepResult.text.includes('需要用户确认')) {
            session.status = 'escalated';
            session.stopReason = '需要用户决策';
            deps.onEscalate?.(sessionId, stepResult.text);
            break;
          }
        }

        if (session.status !== 'running') break;
      }

      if (session.status === 'running') {
        session.status = 'aborted';
        session.stopReason = `达到最大步数 (${config.maxSteps})`;
      }

      session.elapsedMs = Date.now() - startTime;
      return session;
    },

    cancel(sessionId) {
      cancelTokens.add(sessionId);
    },

    getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
