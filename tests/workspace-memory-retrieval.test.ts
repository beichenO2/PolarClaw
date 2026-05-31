import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkSpaceFileMemoryStore } from '../src/workspace-memory/file-store.js';
import { retrieveWorkSpaceMemory } from '../src/workspace-memory/retrieval.js';

describe('retrieveWorkSpaceMemory', () => {
  let dataDir = '';

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('returns matching entries with trace id', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pc-retrieve-'));
    const store = new WorkSpaceFileMemoryStore(dataDir);
    store.writeEntry({
      name: 'layout-preference',
      description: '连线标签字号',
      type: 'project',
      body: '用户要求连线标签 12px 粗体',
    });
    const result = retrieveWorkSpaceMemory(dataDir, '连线标签', { limit: 3 });
    expect(result.entries.length).toBe(1);
    expect(result.systemContext).toContain('WorkSpace 记忆');
    expect(result.traceId).toMatch(/^ws_/);
  });
});
