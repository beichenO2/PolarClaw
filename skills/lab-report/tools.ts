/**
 * Lab Report Generator — MyClaw Skill
 *
 * Workflow: LLM generates section content → officecli assembles .docx from template.
 * Generalised from the original 实验报告/generate_report.py prototype.
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';

const execFileAsync = promisify(execFile);

// ─── LLM Proxy (reuses MyClaw config convention) ───────────────────────

const PP_URL = process.env.POLARPRIVATE_URL ?? 'http://127.0.0.1:12790';
const LLM_BASE = process.env.MYCLAW_LLM_BASE_URL ?? `${PP_URL}/proxy/llm.aliyun.codingplan/v1`;
const LLM_MODEL = process.env.LAB_REPORT_MODEL ?? process.env.MYCLAW_MODEL_GENERAL ?? 'qwen3.6-plus';
const LLM_TIMEOUT_MS = 120_000;

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callLLM(messages: LLMMessage[], maxTokens = 3000): Promise<string> {
  const url = `${LLM_BASE}/chat/completions`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      let content = data.choices[0].message.content;
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return content;
    } catch (err) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      else throw err;
    }
  }
  throw new Error('LLM call failed after 3 attempts');
}

// ─── officecli wrapper ─────────────────────────────────────────────────

async function officecli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('officecli', args, { timeout: 30_000 });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) };
  }
}

// ─── Types ─────────────────────────────────────────────────────────────

interface SectionDef {
  /** Section key for internal tracking */
  key: string;
  /** Section heading in the document (e.g. "四、实验原理") */
  heading: string;
  /** LLM prompt to generate this section's content */
  prompt: string;
  /** Max tokens for this section (default 3000) */
  maxTokens?: number;
  /** If provided, use this literal text instead of calling LLM */
  fixedContent?: string;
}

interface ImageDef {
  /** Absolute path to the image file */
  path: string;
  /** Caption text */
  caption: string;
  /** Width (default "13cm") */
  width?: string;
}

interface TemplateMapping {
  /** paraId of the section heading (anchor for insert-after) */
  headingParaId: string;
  /** paraIds of old content paragraphs to remove */
  removeParaIds: string[];
}

interface GenerateInput {
  /** Experiment context/background (Markdown text given to LLM) */
  experimentContext: string;
  /** LLM system prompt override */
  systemPrompt?: string;
  /** Sections to generate */
  sections: SectionDef[];
  /** Path to the .docx template */
  templatePath: string;
  /** Output .docx path */
  outputPath: string;
  /** Images to insert (appended before a specified anchor, or at document end) */
  images?: ImageDef[];
  /** Anchor paraId before which images are inserted */
  imageAnchorParaId?: string;
  /** Template mapping: which paraIds to remove/insert-after per section key */
  templateMap?: Record<string, TemplateMapping>;
}

// ─── Phase 1: LLM content generation ──────────────────────────────────

async function generateContent(
  input: GenerateInput,
): Promise<Record<string, string>> {
  const systemPrompt = input.systemPrompt ??
    '你是一名大学生，正在撰写实验报告。请根据提供的实验背景资料，用专业、准确、简洁的中文撰写指定章节内容。直接输出章节正文内容，不要加额外说明或标题行。';

  const content: Record<string, string> = {};

  for (const sec of input.sections) {
    if (sec.fixedContent) {
      content[sec.key] = sec.fixedContent;
      continue;
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${input.experimentContext}\n\n${sec.prompt}`,
      },
    ];

    content[sec.key] = await callLLM(messages, sec.maxTokens ?? 3000);
  }

  return content;
}

// ─── Phase 2: Document assembly via officecli ──────────────────────────

async function buildDocument(
  input: GenerateInput,
  content: Record<string, string>,
): Promise<string> {
  const out = resolve(input.outputPath);
  await mkdir(dirname(out), { recursive: true });
  await copyFile(input.templatePath, out);

  await officecli('open', out);

  const tmap = input.templateMap ?? {};

  for (const sec of input.sections) {
    const text = content[sec.key];
    if (!text) continue;

    const mapping = tmap[sec.key];
    if (!mapping) continue;

    // Remove old paragraphs
    for (const pid of mapping.removeParaIds) {
      for (let i = 0; i < 5; i++) {
        const { stdout } = await officecli('remove', out, `/body/p[@paraId=${pid}]`);
        if (stdout.toLowerCase().includes('not found') || stdout.toLowerCase().includes('no element')) break;
      }
    }

    // Insert new content (reverse order so final order is correct)
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of [...lines].reverse()) {
      await officecli(
        'add', out, '/body', '--type', 'paragraph',
        '--prop', `text=${line}`,
        '--after', `/body/p[@paraId=${mapping.headingParaId}]`,
      );
    }
  }

  // Insert images
  if (input.images?.length) {
    const anchor = input.imageAnchorParaId
      ? `/body/p[@paraId=${input.imageAnchorParaId}]`
      : undefined;

    for (const img of input.images) {
      const imgArgs = [
        'add', out, '/body', '--type', 'image',
        '--prop', `src=${img.path}`,
        '--prop', `width=${img.width ?? '13cm'}`,
      ];
      if (anchor) imgArgs.push('--before', anchor);
      await officecli(...imgArgs);

      const capArgs = [
        'add', out, '/body', '--type', 'paragraph',
        '--prop', `text=${img.caption}`,
      ];
      if (anchor) capArgs.push('--before', anchor);
      await officecli(...capArgs);
    }
  }

  await officecli('close', out);
  return out;
}

// ─── Phase 3: Validation ───────────────────────────────────────────────

async function validateDocument(docPath: string): Promise<{
  stats: string;
  outline: string;
  warnings: string;
}> {
  const [stats, outline, validation] = await Promise.all([
    officecli('view', docPath, 'stats'),
    officecli('view', docPath, 'outline'),
    officecli('validate', docPath),
  ]);
  return {
    stats: stats.stdout,
    outline: outline.stdout,
    warnings: validation.stderr.trim(),
  };
}

// ─── Tool: lab_report_generate ─────────────────────────────────────────

export const labReportGenerate: IToolHandler = {
  name: 'lab_report_generate',
  description:
    '完整实验报告生成工作流：LLM 生成各章节内容 → officecli 组装 .docx 文档 → 插入实验图片 → 验证。' +
    '需提供实验背景、模板路径、章节定义、图片列表等。',
  parameters: {
    type: 'object',
    properties: {
      experiment_context: {
        type: 'string',
        description: '实验背景资料（Markdown），包含实验类型、设备、原理、测量结果等',
      },
      system_prompt: {
        type: 'string',
        description: '(可选) LLM system prompt 覆盖',
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '章节标识键' },
            heading: { type: 'string', description: '章节标题' },
            prompt: { type: 'string', description: 'LLM 生成提示词' },
            max_tokens: { type: 'number', description: '最大 token 数（默认 3000）' },
            fixed_content: { type: 'string', description: '(可选) 固定内容，跳过 LLM' },
          },
          required: ['key', 'heading', 'prompt'],
        },
        description: '待生成的章节定义列表',
      },
      template_path: {
        type: 'string',
        description: '.docx 模板文件的绝对路径',
      },
      output_path: {
        type: 'string',
        description: '输出 .docx 文件的绝对路径',
      },
      images: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '图片绝对路径' },
            caption: { type: 'string', description: '图片说明文字' },
            width: { type: 'string', description: '图片宽度（默认 13cm）' },
          },
          required: ['path', 'caption'],
        },
        description: '(可选) 要插入的实验图片列表',
      },
      image_anchor_para_id: {
        type: 'string',
        description: '(可选) 图片插入锚点的 paraId',
      },
      template_map: {
        type: 'object',
        description: '(可选) 章节 key → {headingParaId, removeParaIds[]} 的映射，控制模板中段落的删除和插入位置',
      },
      cache_path: {
        type: 'string',
        description: '(可选) JSON 缓存路径。如果文件存在则跳过 LLM 生成，直接构建文档',
      },
    },
    required: ['experiment_context', 'sections', 'template_path', 'output_path'],
  },
  async handler(args) {
    const input: GenerateInput = {
      experimentContext: String(args.experiment_context ?? ''),
      systemPrompt: args.system_prompt ? String(args.system_prompt) : undefined,
      sections: (args.sections as SectionDef[]).map((s: Record<string, unknown>) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt ?? ''),
        maxTokens: s.max_tokens ? Number(s.max_tokens) : undefined,
        fixedContent: s.fixed_content ? String(s.fixed_content) : undefined,
      })),
      templatePath: String(args.template_path),
      outputPath: String(args.output_path),
      images: args.images
        ? (args.images as Array<Record<string, unknown>>).map((img) => ({
            path: String(img.path),
            caption: String(img.caption),
            width: img.width ? String(img.width) : undefined,
          }))
        : undefined,
      imageAnchorParaId: args.image_anchor_para_id
        ? String(args.image_anchor_para_id)
        : undefined,
      templateMap: args.template_map as Record<string, TemplateMapping> | undefined,
    };

    // Check cache
    const cachePath = args.cache_path ? String(args.cache_path) : undefined;
    let content: Record<string, string>;

    if (cachePath) {
      try {
        const cached = await readFile(cachePath, 'utf8');
        content = JSON.parse(cached) as Record<string, string>;
      } catch {
        content = await generateContent(input);
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, JSON.stringify(content, null, 2), 'utf8');
      }
    } else {
      content = await generateContent(input);
    }

    const outputPath = await buildDocument(input, content);
    const validation = await validateDocument(outputPath);

    return {
      success: true,
      output_path: outputPath,
      sections_generated: Object.keys(content).length,
      section_lengths: Object.fromEntries(
        Object.entries(content).map(([k, v]) => [k, v.length]),
      ),
      validation,
    };
  },
};

// ─── Tool: lab_report_preview ──────────────────────────────────────────

export const labReportPreview: IToolHandler = {
  name: 'lab_report_preview',
  description:
    '仅运行 LLM 内容生成（不构建文档），返回各章节文本。用于预览和调整后再正式构建。',
  parameters: {
    type: 'object',
    properties: {
      experiment_context: {
        type: 'string',
        description: '实验背景资料（Markdown）',
      },
      system_prompt: {
        type: 'string',
        description: '(可选) LLM system prompt 覆盖',
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            heading: { type: 'string' },
            prompt: { type: 'string' },
            max_tokens: { type: 'number' },
            fixed_content: { type: 'string' },
          },
          required: ['key', 'heading', 'prompt'],
        },
        description: '待生成的章节定义列表',
      },
    },
    required: ['experiment_context', 'sections'],
  },
  async handler(args) {
    const input: GenerateInput = {
      experimentContext: String(args.experiment_context ?? ''),
      systemPrompt: args.system_prompt ? String(args.system_prompt) : undefined,
      sections: (args.sections as Array<Record<string, unknown>>).map((s) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt ?? ''),
        maxTokens: s.max_tokens ? Number(s.max_tokens) : undefined,
        fixedContent: s.fixed_content ? String(s.fixed_content) : undefined,
      })),
      templatePath: '',
      outputPath: '',
    };

    const content = await generateContent(input);

    return {
      success: true,
      sections: Object.fromEntries(
        Object.entries(content).map(([k, v]) => [k, { length: v.length, text: v }]),
      ),
    };
  },
};

// ─── Tool: lab_report_health ───────────────────────────────────────────

export const labReportHealth: IToolHandler = {
  name: 'lab_report_health',
  description: '检查 lab-report skill 依赖状态：officecli 是否可用、LLM Proxy 是否连通。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const checks: Record<string, unknown> = {};

    // officecli
    try {
      const { stdout } = await execFileAsync('officecli', ['--version'], { timeout: 5000 });
      checks.officecli = { available: true, version: stdout.trim() };
    } catch {
      checks.officecli = { available: false };
    }

    // LLM Proxy
    try {
      const modelsUrl = `${LLM_BASE}/models`;
      const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) });
      checks.llm_proxy = { reachable: res.ok, url: LLM_BASE, model: LLM_MODEL };
    } catch {
      checks.llm_proxy = { reachable: false, url: LLM_BASE };
    }

    return checks;
  },
};

// ─── Export ────────────────────────────────────────────────────────────

export const labReportTools: IToolHandler[] = [
  labReportGenerate,
  labReportPreview,
  labReportHealth,
];
