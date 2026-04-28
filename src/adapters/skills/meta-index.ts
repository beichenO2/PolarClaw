/**
 * Meta Index — 轻量级技能目录
 *
 * 扫描 skills 目录，只解析 SKILL.md 的 frontmatter 元数据。
 * 不加载 tools.ts，不注册任何工具。
 *
 * 用途：
 * - 注入 system prompt（Agent 知道有哪些能力可用）
 * - 为 skill_search 提供本地索引
 * - 为 skill_activate 提供路径映射
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ISkillIndexEntry } from '../../ports/skills.js';

export interface IMetaIndex {
  /** 扫描目录并构建索引 */
  scan(dirs: string[]): void;
  /** 搜索技能（模糊匹配名称和描述） */
  search(query: string): ISkillIndexEntry[];
  /** 获取所有索引条目 */
  all(): ISkillIndexEntry[];
  /** 按名称查找 */
  get(name: string): ISkillIndexEntry | undefined;
  /** 标记技能为已激活 */
  markActivated(name: string, toolNames: string[]): void;
  /** 标记技能为未激活 */
  markDeactivated(name: string): void;
  /** 生成注入 system prompt 的技能目录文本 */
  toPromptCatalog(): string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) result[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

function extractToolNames(skillDir: string): string[] {
  const toolsPath = join(skillDir, 'tools.ts');
  const toolsJsPath = join(skillDir, 'tools.js');
  const path = existsSync(toolsPath) ? toolsPath : existsSync(toolsJsPath) ? toolsJsPath : null;
  if (!path) return [];

  try {
    const content = readFileSync(path, 'utf8');
    const names: string[] = [];
    const nameRegex = /name:\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = nameRegex.exec(content)) !== null) {
      names.push(match[1]!);
    }
    return names;
  } catch {
    return [];
  }
}

export function createMetaIndex(): IMetaIndex {
  const index = new Map<string, ISkillIndexEntry>();

  return {
    scan(dirs) {
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
          const skillDir = join(dir, entry);
          if (!statSync(skillDir).isDirectory()) continue;
          const skillMdPath = join(skillDir, 'SKILL.md');
          if (!existsSync(skillMdPath)) continue;

          const content = readFileSync(skillMdPath, 'utf8');
          const fm = parseFrontmatter(content);
          const name = fm.name || basename(skillDir);

          if (index.has(name)) continue;

          const toolNames = extractToolNames(skillDir);
          const origin = (fm.origin as ISkillIndexEntry['origin']) || 'static';

          index.set(name, {
            name,
            description: fm.description || '',
            toolNames,
            origin,
            status: origin === 'static' ? 'verified' : (fm.status as ISkillIndexEntry['status']) || 'draft',
            activated: false,
            skillDir,
          });
        }
      }
    },

    search(query) {
      const q = query.toLowerCase();
      const results: ISkillIndexEntry[] = [];
      for (const entry of index.values()) {
        if (
          entry.name.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q) ||
          entry.toolNames.some(t => t.toLowerCase().includes(q))
        ) {
          results.push(entry);
        }
      }
      return results;
    },

    all() {
      return Array.from(index.values());
    },

    get(name) {
      return index.get(name);
    },

    markActivated(name, toolNames) {
      const entry = index.get(name);
      if (entry) {
        entry.activated = true;
        entry.toolNames = toolNames;
      }
    },

    markDeactivated(name) {
      const entry = index.get(name);
      if (entry) entry.activated = false;
    },

    toPromptCatalog() {
      const entries = Array.from(index.values());
      if (entries.length === 0) return '';

      const lines = ['## 可用技能', '', '使用 `skill_search` 搜索，`skill_activate` 加载后使用。', ''];

      const activated = entries.filter(e => e.activated);
      const available = entries.filter(e => !e.activated);

      if (activated.length > 0) {
        lines.push('**已激活（工具可直接使用）：**');
        for (const e of activated) {
          lines.push(`- **${e.name}**: ${e.description} (${e.toolNames.length} 工具)`);
        }
        lines.push('');
      }

      if (available.length > 0) {
        lines.push('**可用（需 skill_activate 加载）：**');
        for (const e of available) {
          const badge = e.status === 'verified' ? '✅' : e.status === 'draft' ? '📝' : '⏸️';
          lines.push(`- ${badge} ${e.name}: ${e.description}`);
        }
      }

      return lines.join('\n');
    },
  };
}
