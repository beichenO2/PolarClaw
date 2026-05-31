import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { MemoryEntry, MemoryFileFrontmatter, MemoryRecordType, MemoryWriteInput } from './types.js';

const PROJECT_DIR = join('memory', 'Project');
const FEEDBACK_DIR = join('memory', 'Feedback');

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'memory-item';
}

function parseMarkdownFile(content: string): { frontmatter: MemoryFileFrontmatter; body: string } {
  if (!content.startsWith('---\n')) {
    throw new Error('memory file missing frontmatter');
  }
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('memory file frontmatter not closed');
  const rawFrontmatter = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontmatter: Record<string, string> = {};
  for (const line of rawFrontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return {
    frontmatter: frontmatter as unknown as MemoryFileFrontmatter,
    body,
  };
}

function serializeMarkdown(frontmatter: MemoryFileFrontmatter, body: string): string {
  const lines = [
    '---',
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    `type: ${frontmatter.type}`,
    `scope: ${frontmatter.scope}`,
    ...(frontmatter.projectId ? [`projectId: ${frontmatter.projectId}`] : []),
    `updatedAt: ${frontmatter.updatedAt}`,
    ...(frontmatter.sourceSessionKey ? [`sourceSessionKey: ${frontmatter.sourceSessionKey}`] : []),
    '---',
    body.trimEnd(),
    '',
  ];
  return lines.join('\n');
}

function dirForType(type: MemoryRecordType): string {
  return type === 'feedback' ? FEEDBACK_DIR : PROJECT_DIR;
}

export class WorkSpaceFileMemoryStore {
  constructor(private readonly memoryDataDir: string) {}

  ensureLayout(): void {
    for (const dir of [PROJECT_DIR, FEEDBACK_DIR].map((d) => join(this.memoryDataDir, d))) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  writeEntry(input: MemoryWriteInput): MemoryEntry {
    this.ensureLayout();
    const now = new Date().toISOString();
    const frontmatter: MemoryFileFrontmatter = {
      name: input.name,
      description: input.description,
      type: input.type,
      scope: 'project',
      projectId: input.projectId,
      updatedAt: now,
      sourceSessionKey: input.sourceSessionKey,
    };
    const fileName = `${slugify(input.name)}.md`;
    const relativePath = join(dirForType(input.type), fileName).replace(/\\/g, '/');
    const absolutePath = join(this.memoryDataDir, relativePath);
    writeFileSync(absolutePath, serializeMarkdown(frontmatter, input.body), 'utf-8');
    return this.readEntry(relativePath)!;
  }

  readEntry(relativePath: string): MemoryEntry | undefined {
    const absolutePath = resolve(this.memoryDataDir, relativePath);
    if (!existsSync(absolutePath)) return undefined;
    const content = readFileSync(absolutePath, 'utf-8');
    const { frontmatter, body } = parseMarkdownFile(content);
    return {
      relativePath: relativePath.replace(/\\/g, '/'),
      absolutePath,
      frontmatter,
      body,
      preview: body.replace(/\s+/g, ' ').trim().slice(0, 220),
    };
  }

  listEntries(kind: MemoryRecordType | 'all' = 'all'): MemoryEntry[] {
    this.ensureLayout();
    const dirs =
      kind === 'all'
        ? [PROJECT_DIR, FEEDBACK_DIR]
        : [dirForType(kind)];
    const entries: MemoryEntry[] = [];
    for (const dir of dirs) {
      const abs = join(this.memoryDataDir, dir);
      if (!existsSync(abs)) continue;
      for (const file of readdirSync(abs)) {
        if (!file.endsWith('.md')) continue;
        const rel = join(dir, file).replace(/\\/g, '/');
        const entry = this.readEntry(rel);
        if (entry) entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.frontmatter.updatedAt.localeCompare(a.frontmatter.updatedAt));
  }

  deleteEntry(relativePath: string): boolean {
    const absolutePath = resolve(this.memoryDataDir, relativePath);
    if (!existsSync(absolutePath)) return false;
    unlinkSync(absolutePath);
    return true;
  }
}
