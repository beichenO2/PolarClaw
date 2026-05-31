// Pattern from PilotDeck always-on tools (AGPL, rewritten)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IToolHandler } from '../../ports/tools.js';

export type DiscoveryPlanPayload = {
  title: string;
  objective: string;
  acceptance: string;
  rationale?: string;
};

export type PlanWriteResult = {
  planId: string;
  relativePath: string;
  absolutePath: string;
};

const planContext = new Map<string, { plansDir: string; runId: string; projectRoot: string }>();
let activePlanSession: string | undefined;

export function setDiscoveryPlanContext(
  sessionKey: string,
  ctx: { plansDir: string; runId: string; projectRoot: string },
): void {
  planContext.set(sessionKey, ctx);
  activePlanSession = sessionKey;
}

export function clearDiscoveryPlanContext(sessionKey: string): void {
  planContext.delete(sessionKey);
  if (activePlanSession === sessionKey) activePlanSession = undefined;
}

export function createAlwaysOnDiscoveryPlanTool(): IToolHandler {
  return {
    name: 'always_on_discovery_plan',
    description: 'Write an Always-On discovery plan (max one task per run).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        objective: { type: 'string', description: 'What to accomplish' },
        acceptance: { type: 'string', description: 'Verifiable done criteria' },
        rationale: { type: 'string', description: 'Why now' },
      },
      required: ['title', 'objective', 'acceptance'],
    },
    handler(args) {
      const title = String(args.title ?? '').trim();
      const objective = String(args.objective ?? '').trim();
      const acceptance = String(args.acceptance ?? '').trim();
      if (!title || !objective || !acceptance) {
        return JSON.stringify({ error: 'title, objective, acceptance required' });
      }

      const sessionKey = activePlanSession ?? 'default';
      const ctx = planContext.get(sessionKey);
      if (!ctx) {
        return JSON.stringify({ error: 'plan context not set for session' });
      }

      const planId = ctx.runId;
      if (!existsSync(ctx.plansDir)) mkdirSync(ctx.plansDir, { recursive: true });
      const fileName = `${planId}.md`;
      const absolutePath = join(ctx.plansDir, fileName);
      const body = `# ${title}

**runId:** ${ctx.runId}
**project:** ${ctx.projectRoot}

## Objective
${objective}

## Acceptance
${acceptance}

${args.rationale ? `## Rationale\n${String(args.rationale)}\n` : ''}`;

      writeFileSync(absolutePath, body, 'utf-8');
      const result: PlanWriteResult = {
        planId,
        relativePath: `plans/${fileName}`,
        absolutePath,
      };
      return JSON.stringify(result);
    },
  };
}

export function parsePlanFromToolResult(toolResults: string[]): PlanWriteResult | null {
  for (const raw of toolResults) {
    try {
      const parsed = JSON.parse(raw) as PlanWriteResult;
      if (parsed.planId && parsed.absolutePath) return parsed;
    } catch {
      // continue
    }
  }
  return null;
}
