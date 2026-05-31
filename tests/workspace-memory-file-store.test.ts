import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkSpaceFileMemoryStore } from '../src/workspace-memory/file-store.js';

describe('WorkSpaceFileMemoryStore', () => {
  let dataDir = '';

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('writes and lists project memory markdown entries', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pc-mem-'));
    const store = new WorkSpaceFileMemoryStore(dataDir);
    const entry = store.writeEntry({
      name: 'layout-preference',
      description: '连线标签字号与标题一致',
      type: 'project',
      body: '用户要求 12px 粗体标签。',
      projectId: 'polarui--abc',
      sourceSessionKey: 'web:conv-1',
    });
    expect(entry.relativePath).toContain('memory/Project/');
    const listed = store.listEntries('project');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.frontmatter.name).toBe('layout-preference');
  });
});
