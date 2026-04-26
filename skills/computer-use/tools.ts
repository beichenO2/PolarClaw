/**
 * ComputerUse — 浏览器自动化技能工具
 *
 * 使用 Stagehand（Playwright AI 层）实现自然语言驱动的浏览器操作。
 * 支持 Docker 隔离模式（COMPUTER_USE_DOCKER=1）。
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const SCREENSHOT_DIR = resolve(process.env.HOME ?? '/tmp', 'Polarisor/MyClaw/data/screenshots');

function ensureScreenshotDir(): void {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

/**
 * Lazy-load Stagehand to avoid import errors when not installed.
 */
async function getStagehand(): Promise<{
  Stagehand: new (opts: Record<string, unknown>) => {
    init(): Promise<void>;
    page: {
      goto(url: string): Promise<void>;
      screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
      url(): string;
      title(): Promise<string>;
    };
    act(action: string): Promise<{ success: boolean; message?: string }>;
    extract(opts: { instruction: string; schema?: unknown }): Promise<unknown>;
    observe(opts?: { instruction?: string }): Promise<Array<{ description: string; selector: string }>>;
    close(): Promise<void>;
  };
} | null> {
  try {
    return await import('@browserbasehq/stagehand') as any;
  } catch {
    return null;
  }
}

async function withBrowser<T>(
  fn: (stagehand: Awaited<NonNullable<Awaited<ReturnType<typeof getStagehand>>>>['Stagehand'] extends new (o: any) => infer I ? I : never) => Promise<T>,
): Promise<T> {
  const mod = await getStagehand();
  if (!mod) {
    throw new Error(
      'Stagehand not installed. Run: npm install @browserbasehq/stagehand playwright',
    );
  }

  const instance = new mod.Stagehand({
    env: 'LOCAL',
    headless: true,
    enableCaching: true,
  });

  await instance.init();
  try {
    return await fn(instance as any);
  } finally {
    await instance.close();
  }
}

// ─── Tool 1: Browse and Act ────────────────────────────────

export const browse_and_act: IToolHandler = {
  name: 'computer_use_browse',
  description: '使用浏览器导航到指定 URL 并执行自然语言描述的操作（点击、填写、滚动等）。返回操作结果和页面状态。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标网页 URL' },
      action: { type: 'string', description: '要执行的操作（自然语言描述）' },
      screenshot: { type: 'boolean', description: '操作完成后是否截图（默认 true）' },
    },
    required: ['url', 'action'],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? '');
    const action = String(args.action ?? '');
    const takeScreenshot = args.screenshot !== false;

    if (!url || !action) return JSON.stringify({ ok: false, error: 'url and action required' });

    try {
      const result = await withBrowser(async (browser) => {
        await browser.page.goto(url);
        const actionResult = await browser.act(action);

        let screenshotPath: string | undefined;
        if (takeScreenshot) {
          ensureScreenshotDir();
          const filename = `browse-${Date.now()}.png`;
          screenshotPath = join(SCREENSHOT_DIR, filename);
          await browser.page.screenshot({ path: screenshotPath });
        }

        return {
          ok: true,
          action_result: actionResult,
          page_url: browser.page.url(),
          page_title: await browser.page.title(),
          screenshot: screenshotPath,
        };
      });

      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

// ─── Tool 2: Screenshot and Analyze ────────────────────────

export const screenshot_and_analyze: IToolHandler = {
  name: 'computer_use_screenshot',
  description: '截取指定 URL 的页面截图。可配合 VLM 视觉模型分析 UI 质量和布局。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标网页 URL' },
      full_page: { type: 'boolean', description: '是否截取完整页面（默认 false）' },
      observe: { type: 'boolean', description: '是否同时返回页面可交互元素列表（默认 false）' },
    },
    required: ['url'],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? '');
    const fullPage = Boolean(args.full_page);
    const doObserve = Boolean(args.observe);

    if (!url) return JSON.stringify({ ok: false, error: 'url required' });

    try {
      const result = await withBrowser(async (browser) => {
        await browser.page.goto(url);

        ensureScreenshotDir();
        const filename = `screenshot-${Date.now()}.png`;
        const screenshotPath = join(SCREENSHOT_DIR, filename);
        await browser.page.screenshot({ path: screenshotPath, fullPage });

        let elements: Array<{ description: string; selector: string }> | undefined;
        if (doObserve) {
          elements = await browser.observe({ instruction: '列出页面上所有可交互元素' });
        }

        return {
          ok: true,
          screenshot: screenshotPath,
          page_url: browser.page.url(),
          page_title: await browser.page.title(),
          elements,
        };
      });

      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

// ─── Tool 3: Fill Form ─────────────────────────────────────

export const fill_form: IToolHandler = {
  name: 'computer_use_fill_form',
  description: '在指定页面上填写表单。接受字段名和值的映射，自动定位并填写。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '表单页面 URL' },
      fields: {
        type: 'object',
        description: '表单字段映射，key 是字段描述（如"用户名"、"邮箱"），value 是要填写的值',
        additionalProperties: { type: 'string' },
      },
      submit: { type: 'boolean', description: '填写完后是否提交表单（默认 false）' },
    },
    required: ['url', 'fields'],
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? '');
    const fields = args.fields as Record<string, string> | undefined;
    const submit = Boolean(args.submit);

    if (!url || !fields) return JSON.stringify({ ok: false, error: 'url and fields required' });

    try {
      const result = await withBrowser(async (browser) => {
        await browser.page.goto(url);

        const results: Array<{ field: string; success: boolean; message?: string }> = [];

        for (const [fieldDesc, value] of Object.entries(fields)) {
          const r = await browser.act(`在"${fieldDesc}"字段中输入"${value}"`);
          results.push({ field: fieldDesc, success: r.success, message: r.message });
        }

        if (submit) {
          const submitResult = await browser.act('点击提交按钮或确认按钮');
          results.push({ field: '__submit__', success: submitResult.success, message: submitResult.message });
        }

        ensureScreenshotDir();
        const filename = `form-${Date.now()}.png`;
        const screenshotPath = join(SCREENSHOT_DIR, filename);
        await browser.page.screenshot({ path: screenshotPath });

        return {
          ok: true,
          results,
          page_url: browser.page.url(),
          screenshot: screenshotPath,
        };
      });

      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export default [browse_and_act, screenshot_and_analyze, fill_form];
