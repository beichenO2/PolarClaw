import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReportPrompt } from '../prompts/discoveryPrompt.js';
import { clearReportContext, setReportContext } from '../tool/AlwaysOnReportTool.js';
import { deriveReportSessionKey } from '../storage/AlwaysOnPaths.js';
import type { DiscoveryAgent } from './discovery-runner.js';

export function buildExecutePrompt(input: {
  projectRoot: string;
  worktreePath: string;
  runId: string;
  planPath: string;
  language?: 'en' | 'zh-CN';
}): string {
  let planBody = '';
  try {
    planBody = readFileSync(input.planPath, 'utf-8');
  } catch {
    planBody = '(plan file unreadable)';
  }

  if (input.language === 'en') {
    return `# Always-On Execute

Execute **one** task in the isolated git worktree. Do **not** git push.

- Canonical project: ${input.projectRoot}
- Worktree (cwd for edits): ${input.worktreePath}
- runId: ${input.runId}

## Plan
${planBody}

## Rules
1. All file edits under the worktree path only
2. Run verifiable checks (tests/lint) if applicable
3. Do not call ask_user_question or git push
4. Summarize what you changed when done`;
  }

  return `# Always-On 执行

在隔离 git worktree 中执行 **一个** 任务。禁止 git push。

- 项目根: ${input.projectRoot}
- Worktree（编辑 cwd）: ${input.worktreePath}
- runId: ${input.runId}

## 计划
${planBody}

## 规则
1. 所有文件修改限定在 worktree 路径内
2. 如有验收标准，运行测试/lint 等可验证检查
3. 禁止 ask_user_question、git push
4. 完成后简要说明改动`;
}

export async function runExecuteTurn(deps: {
  agent: DiscoveryAgent;
  projectRoot: string;
  worktreePath: string;
  runId: string;
  planPath: string;
  language?: 'en' | 'zh-CN';
}): Promise<{ sessionKey: string; text: string }> {
  const sessionKey = `always-on/execute:project=${deps.projectRoot}:run=${deps.runId}`;
  const prompt = buildExecutePrompt({
    projectRoot: deps.projectRoot,
    worktreePath: deps.worktreePath,
    runId: deps.runId,
    planPath: deps.planPath,
    language: deps.language,
  });

  try {
    const result = await deps.agent.handleMessage(
      'always-on/execute',
      'always-on',
      prompt,
      sessionKey,
      undefined,
      undefined,
      deps.worktreePath,
    );
    return { sessionKey, text: result.text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sessionKey, text: msg };
  }
}

export async function runReportTurnAfterExecute(deps: {
  agent: DiscoveryAgent;
  projectRoot: string;
  runId: string;
  reportsDir: string;
  discoveryText: string;
  executeText: string;
  planTitle?: string;
  language?: 'en' | 'zh-CN';
}): Promise<{ sessionKey: string; text: string }> {
  const sessionKey = deriveReportSessionKey(deps.projectRoot, deps.runId);
  setReportContext(sessionKey, {
    reportsDir: deps.reportsDir,
    runId: deps.runId,
    projectRoot: deps.projectRoot,
  });

  try {
    const combined = `${deps.discoveryText}\n\n--- execute ---\n${deps.executeText}`;
    const prompt = buildReportPrompt({
      projectRoot: deps.projectRoot,
      runId: deps.runId,
      discoveryText: combined,
      planTitle: deps.planTitle,
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
  } finally {
    clearReportContext(sessionKey);
  }
}
