/**
 * File Pipeline — PolarClaw 文件处理编排工具
 *
 * file_extract: 解压压缩包到子目录
 * file_batch_ingest: 遍历目录，按类型提取内容并摄入 KnowLever
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, extname, basename } from 'node:path';
import { readdir, readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

const execFileAsync = promisify(execFile);

const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.tar.gz']);
const TEXT_EXTS = new Set(['.md', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.sh', '.sql', '.r', '.tex']);
const OFFICE_EXTS = new Set(['.pptx', '.docx', '.xlsx']);
const PDF_EXTS = new Set(['.pdf']);
const MAX_TEXT_SIZE = 500_000; // 500KB per file

// ─── Tool 1: Extract Archive ────────────────────────────────────────

export const fileExtract: IToolHandler = {
  name: 'file_extract',
  description:
    '解压压缩文件（zip/tar/rar/7z）到子目录。返回解压后的目录路径和文件列表。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '压缩文件路径' },
      output_dir: {
        type: 'string',
        description: '解压目标目录（默认: 同级 _extracted/{basename}/）',
      },
    },
    required: ['path'],
  },
  async handler(args) {
    const filePath = resolve(String(args.path ?? '').replace(/^file:\/\//, ''));
    if (!existsSync(filePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    const ext = extname(filePath).toLowerCase();
    const base = basename(filePath, ext);
    const outDir = args.output_dir
      ? resolve(String(args.output_dir))
      : resolve(filePath, '..', '_extracted', base);

    if (!existsSync(outDir)) {
      await mkdir(outDir, { recursive: true });
    }

    try {
      let cmd: string;
      let cmdArgs: string[];

      if (ext === '.zip') {
        cmd = 'unzip';
        cmdArgs = ['-o', filePath, '-d', outDir];
      } else if (ext === '.tar' || ext === '.tgz' || filePath.endsWith('.tar.gz')) {
        cmd = 'tar';
        cmdArgs = ['-xf', filePath, '-C', outDir];
      } else if (ext === '.rar') {
        cmd = 'unrar';
        cmdArgs = ['x', '-o+', filePath, outDir];
      } else if (ext === '.7z') {
        cmd = '7z';
        cmdArgs = ['x', filePath, `-o${outDir}`, '-y'];
      } else {
        return { success: false, error: `不支持的压缩格式: ${ext}` };
      }

      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        timeout: 120_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      const files = await listDirRecursive(outDir);
      return {
        success: true,
        output_dir: outDir,
        file_count: files.length,
        files: files.slice(0, 50),
        stdout: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        output_dir: outDir,
      };
    }
  },
};

// ─── Tool 2: Batch Ingest ──────────────────────────────────────────

export const fileBatchIngest: IToolHandler = {
  name: 'file_batch_ingest',
  description:
    '遍历目录内所有文件，按类型提取内容（文本直读、Office 用 officecli、PDF 用 pdftotext），' +
    '然后逐文件摄入 KnowLever 知识库。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '目录路径' },
      topic: { type: 'string', description: 'KnowLever topic 名称' },
      user: { type: 'string', description: '用户名（默认 admin）' },
      exclude_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: '排除的文件名模式（如 node_modules, .git）',
      },
    },
    required: ['dir', 'topic'],
  },
  async handler(args) {
    const dirPath = resolve(String(args.dir ?? '').replace(/^file:\/\//, ''));
    const topic = String(args.topic ?? '').trim();
    const user = String(args.user ?? 'admin').trim();
    const excludes = (args.exclude_patterns as string[] | undefined) ?? ['node_modules', '.git', '__pycache__', '.DS_Store'];

    if (!topic) return { success: false, error: 'topic 不能为空' };
    if (!existsSync(dirPath)) return { success: false, error: `目录不存在: ${dirPath}` };

    const files = await listDirRecursive(dirPath, excludes);
    let ingested = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const ingestedFiles: string[] = [];

    let klBase: string;
    try {
      klBase = await getServiceUrl(SERVICES.KNOWLEVER_RAG.name, SERVICES.KNOWLEVER_RAG.gateway);
    } catch {
      return { success: false, error: 'KnowLever RAG 服务不可达' };
    }

    for (const filePath of files) {
      const ext = extname(filePath).toLowerCase();
      const relPath = filePath.replace(dirPath, '').replace(/^\//, '');
      let content: string | null = null;

      try {
        if (TEXT_EXTS.has(ext)) {
          const fileContent = await readFile(filePath, 'utf-8');
          content = fileContent.slice(0, MAX_TEXT_SIZE);
        } else if (OFFICE_EXTS.has(ext)) {
          try {
            const { stdout } = await execFileAsync('officecli', ['read', filePath], {
              timeout: 30_000,
              maxBuffer: 5 * 1024 * 1024,
            });
            content = stdout.slice(0, MAX_TEXT_SIZE);
          } catch {
            skipped++;
            errors.push(`officecli 提取失败: ${relPath}`);
            continue;
          }
        } else if (PDF_EXTS.has(ext)) {
          try {
            const { stdout } = await execFileAsync('pdftotext', [filePath, '-'], {
              timeout: 30_000,
              maxBuffer: 5 * 1024 * 1024,
            });
            content = stdout.slice(0, MAX_TEXT_SIZE);
          } catch {
            skipped++;
            errors.push(`pdftotext 提取失败: ${relPath}`);
            continue;
          }
        } else if (ARCHIVE_EXTS.has(ext)) {
          skipped++;
          continue;
        } else {
          skipped++;
          continue;
        }

        if (!content?.trim()) {
          skipped++;
          continue;
        }

        const docId = `feishu-${topic}-${relPath.replace(/[/\\]/g, '-').replace(/\.[^.]+$/, '')}`;
        const res = await fetch(`${klBase}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: content,
            doc_id: docId,
            user,
            extra_meta: { topic, source_file: relPath },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (res.ok) {
          ingested++;
          ingestedFiles.push(relPath);
        } else {
          failed++;
          errors.push(`摄入失败 ${relPath}: HTTP ${res.status}`);
        }
      } catch (err) {
        failed++;
        errors.push(`处理失败 ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      success: failed === 0,
      total_files: files.length,
      ingested,
      skipped,
      failed,
      topic,
      user,
      ingested_files: ingestedFiles.slice(0, 30),
      errors: errors.slice(0, 10),
    };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

async function listDirRecursive(
  dir: string,
  excludes: string[] = [],
): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludes.some(ex => entry.name === ex || entry.name.startsWith(ex))) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await listDirRecursive(fullPath, excludes);
      result.push(...sub);
    } else if (entry.isFile()) {
      const s = await stat(fullPath);
      if (s.size > 0 && s.size < 100 * 1024 * 1024) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

export const filePipelineTools: IToolHandler[] = [
  fileExtract,
  fileBatchIngest,
];
