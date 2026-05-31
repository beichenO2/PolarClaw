import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findCanonicalProjectRoot } from './canonical-root.js';
import { POLARCLAW_HOME, resolveWorkSpacePaths, type WorkSpacePaths } from './paths.js';
import type { WorkSpaceRecord, WorkSpaceRegistrySnapshot } from './types.js';

const REGISTRY_PATH = resolve(POLARCLAW_HOME, 'workspaces.json');

export class WorkSpaceRegistry {
  private readonly byCanonical = new Map<string, WorkSpaceRecord>();

  constructor(private readonly registryPath: string = REGISTRY_PATH) {
    this.load();
  }

  async register(projectRoot: string): Promise<WorkSpaceRecord> {
    const canonicalRoot = await findCanonicalProjectRoot(projectRoot);
    const paths = resolveWorkSpacePaths(projectRoot, canonicalRoot);
    const existing = this.byCanonical.get(paths.canonicalRoot);
    const now = new Date().toISOString();

    const record: WorkSpaceRecord = {
      ...paths,
      registeredAt: existing?.registeredAt ?? now,
      lastActiveAt: now,
    };

    this.ensureDirs(record);
    this.byCanonical.set(record.canonicalRoot, record);
    this.persist();
    return record;
  }

  getByProjectRoot(projectRoot: string): WorkSpaceRecord | undefined {
    const key = resolve(projectRoot);
    for (const record of this.byCanonical.values()) {
      if (record.projectRoot === key || record.canonicalRoot === key) {
        return record;
      }
    }
    return undefined;
  }

  getByCanonicalRoot(canonicalRoot: string): WorkSpaceRecord | undefined {
    return this.byCanonical.get(resolve(canonicalRoot));
  }

  list(): WorkSpaceRecord[] {
    return [...this.byCanonical.values()].sort((a, b) =>
      (b.lastActiveAt ?? b.registeredAt).localeCompare(a.lastActiveAt ?? a.registeredAt),
    );
  }

  touch(projectRoot: string): void {
    const record = this.getByProjectRoot(projectRoot);
    if (!record) return;
    record.lastActiveAt = new Date().toISOString();
    this.byCanonical.set(record.canonicalRoot, record);
    this.persist();
  }

  private ensureDirs(record: WorkSpacePaths): void {
    for (const dir of [record.chatDir, record.memoryDataDir, record.skillsDir, record.alwaysOnDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.registryPath)) return;
    try {
      const raw = readFileSync(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw) as WorkSpaceRegistrySnapshot;
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) return;
      for (const ws of parsed.workspaces) {
        this.byCanonical.set(resolve(ws.canonicalRoot), ws);
      }
    } catch {
      // corrupt registry — start fresh
    }
  }

  private persist(): void {
    const dir = dirname(this.registryPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const snapshot: WorkSpaceRegistrySnapshot = {
      version: 1,
      workspaces: this.list(),
    };
    writeFileSync(this.registryPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }
}
