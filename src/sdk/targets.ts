/**
 * SDK targets module — authorized CRUD on per-project target trees
 *
 * Targets live under each project's `lobster/targets/` directory.
 * Each target is a JSON file (schema-validated) with a companion .md
 * for human readability. Authorization is scoped to the calling
 * project's own sandbox — cross-project access is denied.
 *
 * Design constraints (from 一般规范):
 *   - polaris.json does NOT store lobster_* fields
 *   - targets reference polaris features via polaris_feature_ref
 *   - projects do NOT implement Pilot Runtime brain
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Target, TargetCreateInput, TargetUpdateInput, ArrowLogEntry, RunTestResult } from './types.js';
import { SDKError } from './types.js';

export interface TargetsModuleConfig {
  /** Base Polarisor directory containing project directories */
  polarisorRoot: string;
}

function targetsDir(polarisorRoot: string, projectId: string): string {
  const projectDir = join(polarisorRoot, projectId);
  return join(projectDir, 'lobster', 'targets');
}

function ensureTargetsDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const gitkeep = join(dir, '.gitkeep');
    if (!existsSync(gitkeep)) {
      writeFileSync(gitkeep, '');
    }
  }
}

function validateTarget(target: Partial<Target>): void {
  if (target.name !== undefined && (!target.name || target.name.length > 200)) {
    throw new SDKError('validation_error', 'Target name must be 1-200 characters');
  }
  if (target.status !== undefined && !['active', 'hit', 'moved', 'archived'].includes(target.status)) {
    throw new SDKError('validation_error', `Invalid target status: ${target.status}`);
  }
  if (target.board !== undefined && !['backlog', 'sprint', 'done', 'archived'].includes(target.board)) {
    throw new SDKError('validation_error', `Invalid target board: ${target.board}`);
  }
}

function readTargetFile(filePath: string): Target | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Target;
  } catch {
    return null;
  }
}

function writeTargetFile(filePath: string, target: Target): void {
  writeFileSync(filePath, JSON.stringify(target, null, 2) + '\n');
}

function writeTargetMd(dir: string, target: Target): void {
  const md = [
    `# ${target.name}`,
    '',
    `**ID**: ${target.id}`,
    `**Status**: ${target.status}`,
    `**Board**: ${target.board}`,
    target.polaris_feature_ref ? `**Feature Ref**: ${target.polaris_feature_ref}` : '',
    '',
    target.description,
    '',
    '## Arrow Log',
    '',
    ...target.arrow_log.map(a => `- **${a.ts}** [${a.action}]: ${a.outcome}${a.evidence ? ` (${a.evidence})` : ''}`),
  ].filter(Boolean).join('\n');

  writeFileSync(join(dir, `${target.id}.md`), md + '\n');
}

export function createTargetsModule(config: TargetsModuleConfig) {
  const { polarisorRoot } = config;

  function assertProjectExists(projectId: string): void {
    const projectDir = join(polarisorRoot, projectId);
    if (!existsSync(projectDir)) {
      throw new SDKError('project_not_found', `Project directory not found: ${projectId}`);
    }
  }

  return {
    list(projectId: string): Target[] {
      const dir = targetsDir(polarisorRoot, projectId);
      if (!existsSync(dir)) return [];

      return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => readTargetFile(join(dir, f)))
        .filter((t): t is Target => t !== null)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },

    get(projectId: string, targetId: string): Target {
      const dir = targetsDir(polarisorRoot, projectId);
      const filePath = join(dir, `${targetId}.json`);
      const target = readTargetFile(filePath);
      if (!target) {
        throw new SDKError('target_not_found', `Target ${targetId} not found in project ${projectId}`);
      }
      return target;
    },

    create(projectId: string, input: TargetCreateInput): Target {
      assertProjectExists(projectId);
      validateTarget(input as Partial<Target>);

      const dir = targetsDir(polarisorRoot, projectId);
      ensureTargetsDir(dir);

      const now = new Date().toISOString();
      const target: Target = {
        id: randomUUID(),
        project_id: projectId,
        name: input.name,
        description: input.description,
        status: 'active',
        board: input.board ?? 'backlog',
        polaris_feature_ref: input.polaris_feature_ref,
        arrow_log: [],
        created_at: now,
        updated_at: now,
      };

      writeTargetFile(join(dir, `${target.id}.json`), target);
      writeTargetMd(dir, target);

      return target;
    },

    update(projectId: string, targetId: string, input: TargetUpdateInput): Target {
      const dir = targetsDir(polarisorRoot, projectId);
      const filePath = join(dir, `${targetId}.json`);
      const existing = readTargetFile(filePath);
      if (!existing) {
        throw new SDKError('target_not_found', `Target ${targetId} not found`);
      }

      validateTarget(input as Partial<Target>);

      const updated: Target = {
        ...existing,
        ...Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined),
        ),
        updated_at: new Date().toISOString(),
      };

      writeTargetFile(filePath, updated);
      writeTargetMd(dir, updated);

      return updated;
    },

    appendArrowLog(projectId: string, targetId: string, entry: Omit<ArrowLogEntry, 'ts'>): Target {
      const dir = targetsDir(polarisorRoot, projectId);
      const filePath = join(dir, `${targetId}.json`);
      const existing = readTargetFile(filePath);
      if (!existing) {
        throw new SDKError('target_not_found', `Target ${targetId} not found`);
      }

      const logEntry: ArrowLogEntry = {
        ts: new Date().toISOString(),
        ...entry,
      };

      existing.arrow_log.push(logEntry);
      existing.updated_at = new Date().toISOString();

      writeTargetFile(filePath, existing);
      writeTargetMd(dir, existing);

      return existing;
    },

    moveBoard(projectId: string, targetId: string, board: Target['board']): Target {
      return this.update(projectId, targetId, { board });
    },

    archive(projectId: string, targetId: string): Target {
      return this.update(projectId, targetId, { status: 'archived', board: 'archived' });
    },

    async runTest(projectId: string, targetId: string): Promise<RunTestResult> {
      const target = this.get(projectId, targetId);
      const start = Date.now();

      try {
        const { execSync } = await import('node:child_process');
        const projectDir = join(polarisorRoot, projectId);

        if (!existsSync(join(projectDir, 'package.json'))) {
          return {
            target_id: targetId,
            passed: false,
            output: 'No package.json found — cannot run tests',
            duration_ms: Date.now() - start,
          };
        }

        const output = execSync('npm test --if-present 2>&1', {
          cwd: projectDir,
          timeout: 60_000,
          encoding: 'utf8',
          env: { ...process.env, POLARCLAW_TARGET_ID: targetId },
        });

        const passed = !output.includes('FAIL') && !output.includes('Error');

        this.appendArrowLog(projectId, targetId, {
          action: 'test_run',
          outcome: passed ? 'passed' : 'failed',
          evidence: output.slice(-500),
        });

        return {
          target_id: targetId,
          passed,
          output: output.slice(-2000),
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        this.appendArrowLog(projectId, targetId, {
          action: 'test_run',
          outcome: 'error',
          evidence: errMsg.slice(-500),
        });

        return {
          target_id: targetId,
          passed: false,
          output: errMsg.slice(-2000),
          duration_ms: Date.now() - start,
        };
      }
    },
  };
}

export type TargetsModule = ReturnType<typeof createTargetsModule>;
