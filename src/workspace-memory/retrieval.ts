import type { MemoryEntry } from './types.js';
import { WorkSpaceFileMemoryStore } from './file-store.js';

export interface WorkSpaceRetrievalResult {
  entries: MemoryEntry[];
  systemContext: string;
  traceId: string;
}

function scoreEntry(entry: MemoryEntry, query: string): number {
  const q = query.toLowerCase();
  const haystack = `${entry.frontmatter.name} ${entry.frontmatter.description} ${entry.body}`.toLowerCase();
  if (!q.trim()) return 0;
  let score = 0;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (haystack.includes(token)) score += 1;
  }
  if (entry.frontmatter.name.toLowerCase().includes(q)) score += 2;
  return score;
}

export function retrieveWorkSpaceMemory(
  memoryDataDir: string,
  query: string,
  options?: { limit?: number },
): WorkSpaceRetrievalResult {
  const store = new WorkSpaceFileMemoryStore(memoryDataDir);
  const limit = options?.limit ?? 5;
  const ranked = store
    .listEntries('all')
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.frontmatter.updatedAt.localeCompare(a.entry.frontmatter.updatedAt))
    .slice(0, limit)
    .map((row) => row.entry);

  const traceId = `ws_${Date.now().toString(36)}`;
  if (ranked.length === 0) {
    return { entries: [], systemContext: '', traceId };
  }

  const lines = ranked.map(
    (e) => `### ${e.frontmatter.name}\n${e.frontmatter.description}\n${e.preview}`,
  );
  return {
    entries: ranked,
    systemContext: ['## WorkSpace 记忆', ...lines].join('\n\n'),
    traceId,
  };
}
