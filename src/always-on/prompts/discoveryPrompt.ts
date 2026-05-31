// Pattern from PilotDeck src/always-on/prompts/discoveryPrompts.ts (AGPL, rewritten)

export type DiscoveryPromptInput = {
  projectRoot: string;
  runId: string;
  chatDigest: string;
  language?: 'en' | 'zh-CN';
};

export function buildDiscoveryPrompt(input: DiscoveryPromptInput): string {
  if (input.language === 'en') {
    return buildDiscoveryPromptEn(input);
  }
  return buildDiscoveryPromptZh(input);
}

function buildDiscoveryPromptZh(input: DiscoveryPromptInput): string {
  return `# Always-On Discovery（离席任务发现）

你是 PolarClaw Always-On 发现代理。用户暂时离开，你需要审视项目状态并提出 **最多 1 个** 可自动验收的小任务。

## 约束（必须遵守）
1. **最多 1 个任务** — 不要列清单
2. **必须可自动验收** — 有明确完成标准（测试通过、文件存在、lint 无错等）
3. **无合适任务时** — 回复 exactly: \`NO_ACTIONABLE_TASK\`，**不要**调用任何工具
4. **禁止** ask_user_question、enter_plan_mode、git push
5. 任务应可在 git worktree 沙箱内只读/小改完成（P1 阶段仅 discovery + report）

## 项目
- 路径: \`${input.projectRoot}\`
- runId: \`${input.runId}\`

## 近期上下文摘要
${input.chatDigest || '（无近期聊天摘要）'}

## 输出格式
若发现任务，调用 \`always_on_discovery_plan\` 工具，填写:
- title: 简短标题
- objective: 目标（1-2 句）
- acceptance: 验收标准（可检查）
- rationale: 为何现在做

若无任务，只回复 \`NO_ACTIONABLE_TASK\`。`;
}

function buildDiscoveryPromptEn(input: DiscoveryPromptInput): string {
  return `# Always-On Discovery

You are the PolarClaw Always-On discovery agent. The user is away. Propose **at most one** small, automatically verifiable task.

## Rules
1. At most **one** task
2. Must be **automatically verifiable** (tests pass, file exists, lint clean, etc.)
3. If nothing actionable, reply exactly: \`NO_ACTIONABLE_TASK\` — do **not** call tools
4. Do **not** use ask_user_question, enter_plan_mode, or git push

## Project
- Path: \`${input.projectRoot}\`
- runId: \`${input.runId}\`

## Recent context
${input.chatDigest || '(no recent chat digest)'}

## Output
If you find a task, call \`always_on_discovery_plan\` with title, objective, acceptance, rationale.
Otherwise reply \`NO_ACTIONABLE_TASK\` only.`;
}

export function buildReportPrompt(input: {
  projectRoot: string;
  runId: string;
  planTitle?: string;
  planObjective?: string;
  discoveryText: string;
  language?: 'en' | 'zh-CN';
}): string {
  const lang = input.language ?? 'zh-CN';
  if (lang === 'en') {
    return `# Always-On Report

Summarize the discovery turn for the user. Project: ${input.projectRoot}, run: ${input.runId}.
${input.planTitle ? `Plan: ${input.planTitle}` : 'No plan was filed.'}

Discovery output:
${input.discoveryText}

Call \`always_on_report\` with summary (2-4 sentences) and status: planned | no_action | failed.`;
  }
  return `# Always-On 报告

为用户撰写离席发现摘要。项目: ${input.projectRoot}，run: ${input.runId}。
${input.planTitle ? `已发现任务: ${input.planTitle}` : '未发现可执行任务。'}

发现阶段输出:
${input.discoveryText}

调用 \`always_on_report\` 工具，填写 summary（2-4 句）和 status: planned | no_action | failed。`;
}
