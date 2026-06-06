/**
 * Post-compaction context restore — 压缩后恢复项目关键文档
 *
 * 树状结构（Level 1 / 2 / 3）：
 *   Level 1（≤800 chars）— 结构化摘要，压缩后自动加载
 *     └ polaris.json → name + description + status + requirements 一句话摘要
 *     └ worker.md → 第一段（身份定义）
 *
 *   Level 2（≤3000 chars）— 中等详情，任务启动时加载
 *     └ polaris.json → 完整 requirements（id + need + status + features 名称）
 *     └ worker.md → 完整内容
 *     └ PolarSoul.md → 前 500 chars
 *
 *   Level 3 — 完整文档，按需读取
 *     └ polaris.json 全文
 *     └ roadmap.md 全文（不默认加载）
 *     └ PolarSoul.md 全文
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[已截断]';
}

function extractFirstParagraph(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!started && trimmed.length === 0) continue;
    if (!started && trimmed.startsWith('#')) { result.push(trimmed); started = true; continue; }
    if (started && trimmed.length === 0 && result.length > 1) break;
    if (trimmed.length > 0) { result.push(trimmed); started = true; }
  }
  return result.join('\n');
}

interface PolarisJson {
  name?: string;
  description?: string;
  status?: string;
  requirements?: Array<{
    id?: string;
    need?: string;
    status?: string;
    features?: Array<{ name?: string }>;
  }>;
}

function extractPolarisLevel1(raw: string): string {
  try {
    const data: PolarisJson = JSON.parse(raw);
    const lines: string[] = [];
    if (data.name) lines.push(`**项目**: ${data.name}`);
    if (data.description) lines.push(`**描述**: ${data.description}`);
    if (data.status) lines.push(`**状态**: ${data.status}`);
    if (data.requirements?.length) {
      lines.push(`**需求** (${data.requirements.length}):`);
      for (const r of data.requirements) {
        const featureCount = r.features?.length ?? 0;
        lines.push(`  - [${r.status ?? '?'}] ${r.id ?? '?'}: ${r.need ?? '?'} (${featureCount} features)`);
      }
    }
    return lines.join('\n');
  } catch {
    return truncate(raw, 400);
  }
}

function extractPolarisLevel2(raw: string): string {
  try {
    const data: PolarisJson = JSON.parse(raw);
    const lines: string[] = [];
    if (data.name) lines.push(`**项目**: ${data.name} — ${data.description ?? ''}`);
    if (data.requirements?.length) {
      lines.push('\n**需求详情**:');
      for (const r of data.requirements) {
        lines.push(`\n### ${r.id ?? '?'}: ${r.need ?? '?'} [${r.status ?? '?'}]`);
        if (r.features?.length) {
          for (const f of r.features) {
            if (f.name) lines.push(`  - ${f.name}`);
          }
        }
      }
    }
    return lines.join('\n');
  } catch {
    return truncate(raw, 2000);
  }
}

function resolveRoot(projectRoot?: string): string {
  return projectRoot || process.env.POLARCLAW_PROJECT_ROOT?.trim() || process.cwd();
}

function resolvePolarClawRoot(root: string): string {
  if (existsSync(join(root, 'worker.md'))) return root;
  return dirname(new URL(import.meta.url).pathname)
    .replace(/\/dist\/.*/, '')
    .replace(/\/src\/.*/, '');
}

async function tryRead(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      const content = await readFile(p, 'utf-8');
      if (content.trim()) return content.trim();
    } catch { continue; }
  }
  return null;
}

/**
 * Level 1 恢复：结构化摘要（≤800 chars），压缩后自动注入。
 */
export async function restoreProjectContext(
  projectRoot?: string,
): Promise<string | null> {
  const root = resolveRoot(projectRoot);
  const clawRoot = resolvePolarClawRoot(root);

  const sections: string[] = [];

  const polarisRaw = await tryRead([join(root, 'polaris.json')]);
  if (polarisRaw) {
    sections.push(`### 项目 SSoT\n${extractPolarisLevel1(polarisRaw)}`);
  }

  const workerRaw = await tryRead([join(clawRoot, 'worker.md')]);
  if (workerRaw) {
    sections.push(`### Agent 身份\n${extractFirstParagraph(workerRaw)}`);
  }

  if (sections.length === 0) return null;

  const body = sections.join('\n\n');
  return `[上下文已压缩 — Level 1 概述恢复]\n\n${truncate(body, 800)}`;
}

/**
 * Level 2 恢复：中等详情（≤3000 chars），任务启动时可选注入。
 */
export async function restoreProjectContextL2(
  projectRoot?: string,
): Promise<string | null> {
  const root = resolveRoot(projectRoot);
  const clawRoot = resolvePolarClawRoot(root);

  const sections: string[] = [];

  const polarisRaw = await tryRead([join(root, 'polaris.json')]);
  if (polarisRaw) {
    sections.push(`### 项目 SSoT\n${extractPolarisLevel2(polarisRaw)}`);
  }

  const workerRaw = await tryRead([join(clawRoot, 'worker.md')]);
  if (workerRaw) {
    sections.push(`### Agent 身份 (worker.md)\n${workerRaw}`);
  }

  const soulRaw = await tryRead([
    join(root, 'PolarSoul.md'),
    join(root, '..', 'PolarSoul.md'),
  ]);
  if (soulRaw) {
    sections.push(`### 生态灵魂\n${truncate(soulRaw, 500)}`);
  }

  if (sections.length === 0) return null;

  const body = sections.join('\n\n');
  return `[任务上下文 — Level 2 中等详情]\n\n${truncate(body, 3000)}`;
}
