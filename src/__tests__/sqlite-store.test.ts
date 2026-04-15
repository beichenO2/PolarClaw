import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSqliteMemoryStore } from '../adapters/memory/sqlite-store.js';

describe('createSqliteMemoryStore', () => {
  let dbPath: string;
  let tempDir: string;
  let store: ReturnType<typeof createSqliteMemoryStore>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'myclaw-test-'));
    dbPath = join(tempDir, 'test.db');
    store = createSqliteMemoryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('save + search', () => {
    it('saves and retrieves by FTS', () => {
      store.save({ type: 'note', content: '今天学了 TypeScript 的类型系统' });
      store.save({ type: 'note', content: '明天要做 Python 项目' });
      const result = store.search('TypeScript');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].content).toContain('TypeScript');
    });

    it('returns entry with correct fields', () => {
      const entry = store.save({ type: 'bookmark', content: '重要链接', tags: 'dev ref' });
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.type).toBe('bookmark');
      expect(entry.tags).toBe('dev ref');
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it('returns empty for no matches', () => {
      store.save({ type: 'note', content: 'hello world' });
      const result = store.search('zzzznotfound');
      expect(result.entries).toHaveLength(0);
    });

    it('respects limit option', () => {
      for (let i = 0; i < 20; i++) {
        store.save({ type: 'note', content: `entry number ${i} with some shared text` });
      }
      const result = store.search('entry', { limit: 5 });
      expect(result.entries.length).toBeLessThanOrEqual(5);
    });

    it('handles empty query gracefully', () => {
      store.save({ type: 'note', content: 'something' });
      const result = store.search('');
      expect(result.entries).toHaveLength(0);
    });
  });

  describe('user profiles', () => {
    it('saves and retrieves profile', () => {
      store.saveProfile('u1', 'name', 'Alice');
      expect(store.getProfile('u1', 'name')).toBe('Alice');
    });

    it('upserts existing key', () => {
      store.saveProfile('u1', 'lang', 'en');
      store.saveProfile('u1', 'lang', 'zh');
      expect(store.getProfile('u1', 'lang')).toBe('zh');
    });

    it('returns null for missing key', () => {
      expect(store.getProfile('u1', 'nope')).toBeNull();
    });

    it('lists all profiles for a user', () => {
      store.saveProfile('u1', 'a', '1');
      store.saveProfile('u1', 'b', '2');
      store.saveProfile('u2', 'c', '3');
      const profiles = store.getAllProfiles('u1');
      expect(profiles).toHaveLength(2);
      expect(profiles.every(p => p.userId === 'u1')).toBe(true);
    });
  });
});
