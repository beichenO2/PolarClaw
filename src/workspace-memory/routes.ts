import { Router } from 'express';
import { WorkSpaceRegistry } from '../workspace/registry.js';
import { WorkSpaceFileMemoryStore } from './file-store.js';
import { retrieveWorkSpaceMemory } from './retrieval.js';
import type { MemoryRecordType, MemoryWriteInput } from './types.js';

export function createWorkSpaceMemoryRouter(registry: WorkSpaceRegistry): Router {
  const router = Router();

  async function resolveStore(projectPath: string) {
    const trimmed = projectPath.trim();
    if (!trimmed) throw new Error('projectPath is required');
    let record = registry.getByProjectRoot(trimmed);
    if (!record) {
      record = await registry.register(trimmed);
    }
    return {
      record,
      store: new WorkSpaceFileMemoryStore(record.memoryDataDir),
    };
  }

  router.get('/overview', async (req, res) => {
    try {
      const projectPath = String(req.query.projectPath ?? '');
      const { record, store } = await resolveStore(projectPath);
      const entries = store.listEntries('all');
      res.json({
        projectPath: record.projectRoot,
        projectId: record.projectId,
        memoryDataDir: record.memoryDataDir,
        totalEntries: entries.length,
        projectEntries: entries.filter((e) => e.frontmatter.type === 'project').length,
        feedbackEntries: entries.filter((e) => e.frontmatter.type === 'feedback').length,
        latestMemoryAt: entries[0]?.frontmatter.updatedAt ?? null,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/entries', async (req, res) => {
    try {
      const projectPath = String(req.query.projectPath ?? '');
      const kind = (req.query.kind ?? 'all') as MemoryRecordType | 'all';
      const { store } = await resolveStore(projectPath);
      res.json({ entries: store.listEntries(kind === 'all' ? 'all' : kind) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/entries', async (req, res) => {
    try {
      const { projectPath, entry } = req.body as { projectPath?: string; entry?: MemoryWriteInput };
      if (!projectPath || !entry?.name || !entry.body) {
        return res.status(400).json({ error: 'projectPath + entry{name,body} required' });
      }
      const { record, store } = await resolveStore(projectPath);
      const written = store.writeEntry({
        ...entry,
        type: entry.type ?? 'project',
        description: entry.description ?? entry.name,
        projectId: record.projectId,
      });
      res.json({ entry: written });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/entries', async (req, res) => {
    try {
      const { projectPath, relativePath } = req.body as { projectPath?: string; relativePath?: string };
      if (!projectPath || !relativePath) {
        return res.status(400).json({ error: 'projectPath + relativePath required' });
      }
      const { store } = await resolveStore(projectPath);
      const ok = store.deleteEntry(relativePath);
      res.json({ deleted: ok, relativePath });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/retrieve', async (req, res) => {
    try {
      const { projectPath, query, limit } = req.body as { projectPath?: string; query?: string; limit?: number };
      if (!projectPath || !query) {
        return res.status(400).json({ error: 'projectPath + query required' });
      }
      const { record } = await resolveStore(projectPath);
      const result = retrieveWorkSpaceMemory(record.memoryDataDir, query, { limit });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const { projectPath } = req.body as { projectPath?: string };
      if (!projectPath?.trim()) return res.status(400).json({ error: 'projectPath required' });
      const record = await registry.register(projectPath.trim());
      res.json({ workspace: record });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
