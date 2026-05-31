export type MemoryRecordType = 'user' | 'feedback' | 'project';
export type MemoryScope = 'global' | 'project';

export interface MemoryFileFrontmatter {
  name: string;
  description: string;
  type: MemoryRecordType;
  scope: MemoryScope;
  projectId?: string;
  updatedAt: string;
  sourceSessionKey?: string;
}

export interface MemoryEntry {
  relativePath: string;
  absolutePath: string;
  frontmatter: MemoryFileFrontmatter;
  body: string;
  preview: string;
}

export interface MemoryWriteInput {
  name: string;
  description: string;
  type: MemoryRecordType;
  body: string;
  projectId?: string;
  sourceSessionKey?: string;
}
