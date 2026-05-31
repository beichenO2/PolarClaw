// Pattern from PilotDeck DiscoveryFire session keys (AGPL, rewritten)
import { buildDiscoveryPrompt, buildReportPrompt } from '../prompts/discoveryPrompt.js';
import {
  clearDiscoveryPlanContext,
  setDiscoveryPlanContext,
} from '../tool/AlwaysOnDiscoveryPlanTool.js';
import {
  clearReportContext,
  setReportContext,
} from '../tool/AlwaysOnReportTool.js';
import { deriveDiscoverySessionKey, deriveReportSessionKey } from '../storage/AlwaysOnPaths.js';

export type DiscoveryAgent = {
  handleMessage: (
    channel: string,
    userId: string,
    text: string,
    conversationId?: string,
    projectId?: string,
    onProgress?: (event: unknown) => void,
    workSpaceProjectRoot?: string,
  ) => Promise<{ text: string; usage?: { totalTokens?: number } }>;
};

export type DiscoveryTurnResult = {
  sessionKey: string;
  text: string;
  outcome: 'executed' | 'no_plan' | 'failed';
  planId?: string;
  usage?: { totalTokens?: number };
};

export type ReportTurnResult = {
  sessionKey: string;
  text: string;
  reportPath?: string;
  status?: string;
};

export async function runDiscoveryTurn(deps: {
  agent: DiscoveryAgent;
  projectRoot: string;
  runId: string;
  chatDigest: string;
  plansDir: string;
  language?: 'en' | 'zh-CN';
}): Promise<DiscoveryTurnResult> {
  const sessionKey = deriveDiscoverySessionKey(deps.projectRoot, deps.runId);
  setDiscoveryPlanContext(sessionKey, {
    plansDir: deps.plansDir,
    runId: deps.runId,
    projectRoot: deps.projectRoot,
  });

  try {
    const prompt = buildDiscoveryPrompt({
      projectRoot: deps.projectRoot,
      runId: deps.runId,
      chatDigest: deps.chatDigest,
      language: deps.language,
    });

    const result = await deps.agent.handleMessage(
      'always-on/discovery',
      'always-on',
      prompt,
      sessionKey,
      undefined,
      undefined,
      deps.projectRoot,
    );

    const normalized = result.text.trim();
    if (/NO_ACTIONABLE_TASK/i.test(normalized)) {
      return { sessionKey, text: result.text, outcome: 'no_plan', usage: result.usage };
    }

    const planId = deps.runId;
    return {
      sessionKey,
      text: result.text,
      outcome: 'executed',
      planId,
      usage: result.usage,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sessionKey, text: msg, outcome: 'failed' };
  } finally {
    clearDiscoveryPlanContext(sessionKey);
  }
}

export async function runReportTurn(deps: {
  agent: DiscoveryAgent;
  projectRoot: string;
  runId: string;
  reportsDir: string;
  discoveryText: string;
  planTitle?: string;
  planObjective?: string;
  language?: 'en' | 'zh-CN';
}): Promise<ReportTurnResult> {
  const sessionKey = deriveReportSessionKey(deps.projectRoot, deps.runId);
  setReportContext(sessionKey, {
    reportsDir: deps.reportsDir,
    runId: deps.runId,
    projectRoot: deps.projectRoot,
  });

  try {
    const prompt = buildReportPrompt({
      projectRoot: deps.projectRoot,
      runId: deps.runId,
      discoveryText: deps.discoveryText,
      planTitle: deps.planTitle,
      planObjective: deps.planObjective,
      language: deps.language,
    });

    const result = await deps.agent.handleMessage(
      'always-on/report',
      'always-on',
      prompt,
      sessionKey,
      undefined,
      undefined,
      deps.projectRoot,
    );

    return { sessionKey, text: result.text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sessionKey, text: msg };
  } finally {
    clearReportContext(sessionKey);
  }
}

export function createRunId(now = new Date()): string {
  return `ao-${now.toISOString().replace(/[:.]/g, '-')}`;
}
