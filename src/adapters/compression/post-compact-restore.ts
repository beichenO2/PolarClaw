/**
 * Post-compaction context restore — 压缩后恢复项目关键文档
 *
 * 类似 Claude Code 在 Full Compact 后恢复 CLAUDE.md + 最近文件，
 * PolarClaw 在 Phase 2+ 压缩后注入项目关键文档摘要，
 * 确保 Agent 不会在压缩后丢失项目方向感。
 *
 * 恢复文件优先级：
 *   1. polaris.json — 项目需求/功能/状态 SSoT
 *   2. roadmap.md — 项目路线图
 *   3. PolarSoul.md — 生态灵魂文档
 *   4. SOUL.md — Agent 身份定义（PolarClaw 自身）
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const MAX_RESTORE_TOKENS = 3000;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[已截断]';
}

interface RestoreSource {
  label: string;
  paths: string[];
  maxChars: number;
}

/**
 * 从项目根目录读取关键文档并拼装为恢复 system message。
 * 返回 null 表示无可恢复内容。
 */
export async function restoreProjectContext(
  projectRoot?: string,
): Promise<string | null> {
  const root = projectRoot || process.env.POLARCLAW_PROJECT_ROOT?.trim() || process.cwd();

  const polarClawRoot = existsSync(join(root, 'SOUL.md'))
    ? root
    : dirname(new URL(import.meta.url).pathname).replace(/\/dist\/.*/, '').replace(/\/src\/.*/, '');

  const sources: RestoreSource[] = [
    {
      label: '项目 SSoT (polaris.json)',
      paths: [join(root, 'polaris.json')],
      maxChars: 1500,
    },
    {
      label: '路线图 (roadmap.md)',
      paths: [join(root, 'roadmap.md')],
      maxChars: 800,
    },
    {
      label: '生态灵魂 (PolarSoul.md)',
      paths: [
        join(root, 'PolarSoul.md'),
        join(root, '..', 'PolarSoul.md'),
      ],
      maxChars: 500,
    },
    {
      label: 'Agent 身份 (SOUL.md)',
      paths: [join(polarClawRoot, 'SOUL.md')],
      maxChars: 400,
    },
  ];

  const sections: string[] = [];
  let totalChars = 0;

  for (const src of sources) {
    if (totalChars >= MAX_RESTORE_TOKENS * 3) break;

    for (const path of src.paths) {
      try {
        const content = await readFile(path, 'utf-8');
        if (content.trim()) {
          const truncated = truncate(content.trim(), src.maxChars);
          sections.push(`### ${src.label}\n${truncated}`);
          totalChars += truncated.length;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (sections.length === 0) return null;

  return [
    '[上下文已压缩 — 以下为项目关键文档恢复，确保方向感不丢失]',
    ...sections,
  ].join('\n\n');
}
