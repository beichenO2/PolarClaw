// Pattern from PilotDeck GitWorktreeProvider.ts (AGPL, rewritten)
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class AlwaysOnWorktreeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AlwaysOnWorktreeError';
  }
}

export const POLARCLAW_WORKTREES_DIR =
  process.env.POLARCLAW_WORKTREES ?? resolve(homedir(), '.polarclaw', 'worktrees');

export type WorktreeHandle = {
  worktreePath: string;
  branch: string;
  runId: string;
};

export class GitWorktreeProvider {
  constructor(
    private readonly repoRoot: string,
    private readonly baseDir: string = POLARCLAW_WORKTREES_DIR,
  ) {}

  async create(runId: string): Promise<WorktreeHandle> {
    const branch = `polarclaw-always-on/${runId}`;
    const worktreePath = resolve(this.baseDir, sanitizeRunId(runId));
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
    if (existsSync(worktreePath)) {
      throw new AlwaysOnWorktreeError(`worktree path already exists: ${worktreePath}`);
    }

    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], {
        cwd: this.repoRoot,
      });
    } catch (err) {
      throw new AlwaysOnWorktreeError(
        `git worktree add failed for ${this.repoRoot}`,
        err,
      );
    }

    return { worktreePath, branch, runId };
  }

  async remove(handle: WorktreeHandle): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', handle.worktreePath, '--force'], {
        cwd: this.repoRoot,
      });
    } catch {
      // worktree may already be gone
    }
    try {
      await execFileAsync('git', ['branch', '-D', handle.branch], {
        cwd: this.repoRoot,
      });
    } catch {
      // branch may already be deleted
    }
  }
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: path });
    return true;
  } catch {
    return false;
  }
}
