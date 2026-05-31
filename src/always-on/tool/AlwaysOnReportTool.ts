import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IToolHandler } from '../../ports/tools.js';

export type ReportWriteResult = {
  runId: string;
  relativePath: string;
  absolutePath: string;
  status: string;
};

const reportContext = new Map<string, { reportsDir: string; runId: string; projectRoot: string }>();
let activeReportSession: string | undefined;

export function setReportContext(
  sessionKey: string,
  ctx: { reportsDir: string; runId: string; projectRoot: string },
): void {
  reportContext.set(sessionKey, ctx);
  activeReportSession = sessionKey;
}

export function clearReportContext(sessionKey: string): void {
  reportContext.delete(sessionKey);
  if (activeReportSession === sessionKey) activeReportSession = undefined;
}

export function createAlwaysOnReportTool(): IToolHandler {
  return {
    name: 'always_on_report',
    description: 'Write Always-On discovery report for user review.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2-4 sentence summary for the user' },
        status: {
          type: 'string',
          enum: ['planned', 'no_action', 'failed'],
          description: 'Outcome status',
        },
      },
      required: ['summary', 'status'],
    },
    handler(args) {
      const summary = String(args.summary ?? '').trim();
      const status = String(args.status ?? 'no_action').trim();
      if (!summary) {
        return JSON.stringify({ error: 'summary required' });
      }

      const sessionKey = activeReportSession ?? 'default';
      const ctx = reportContext.get(sessionKey);
      if (!ctx) {
        return JSON.stringify({ error: 'report context not set for session' });
      }

      if (!existsSync(ctx.reportsDir)) mkdirSync(ctx.reportsDir, { recursive: true });
      const fileName = `${ctx.runId}-report.md`;
      const absolutePath = join(ctx.reportsDir, fileName);
      const body = `# Always-On Report

**runId:** ${ctx.runId}
**project:** ${ctx.projectRoot}
**status:** ${status}
**generatedAt:** ${new Date().toISOString()}

## Summary
${summary}
`;

      writeFileSync(absolutePath, body, 'utf-8');
      const result: ReportWriteResult = {
        runId: ctx.runId,
        relativePath: `output/always-on/${fileName}`,
        absolutePath,
        status,
      };
      return JSON.stringify(result);
    },
  };
}

export function parseReportFromToolResult(toolResults: string[]): ReportWriteResult | null {
  for (const raw of toolResults) {
    try {
      const parsed = JSON.parse(raw) as ReportWriteResult;
      if (parsed.runId && parsed.absolutePath) return parsed;
    } catch {
      // continue
    }
  }
  return null;
}
