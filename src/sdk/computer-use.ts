/**
 * SDK computer-use module — sandbox-external ComputerUse service
 *
 * Other Polarisor projects (Project Lobsters) call PolarClaw via the
 * thin polarclaw-project-sdk client; the corresponding server-side
 * module lives here. ComputerUse stays owned by PolarClaw — no other
 * project ever runs Chromium itself.
 *
 * Implementation note: the same Stagehand calls are also exposed as
 * skills/computer-use/tools.ts for PolarClaw's own ReAct agent. We
 * deliberately keep two thin wrappers around the underlying Stagehand
 * driver instead of cross-importing across rootDir boundaries —
 * skills are loaded by tsx at runtime, src/ is compiled by tsc.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const SCREENSHOT_DIR = resolve(homedir(), 'Polarisor/PolarClaw/data/screenshots');

function ensureScreenshotDir(): void {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

interface StagehandPage {
  goto(url: string): Promise<void>;
  screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  url(): string;
  title(): Promise<string>;
}

interface StagehandInstance {
  init(): Promise<void>;
  page: StagehandPage;
  act(action: string): Promise<{ success: boolean; message?: string }>;
  observe(opts?: { instruction?: string }): Promise<Array<{ description: string; selector: string }>>;
  close(): Promise<void>;
}

interface StagehandModule {
  Stagehand: new (opts: Record<string, unknown>) => StagehandInstance;
}

async function getStagehand(): Promise<StagehandModule | null> {
  try {
    const mod = await import('@browserbasehq/stagehand');
    return mod as unknown as StagehandModule;
  } catch {
    return null;
  }
}

async function withBrowser<T>(fn: (instance: StagehandInstance) => Promise<T>): Promise<T> {
  const mod = await getStagehand();
  if (!mod) {
    throw new Error(
      'Stagehand 未安装。请在 PolarClaw 容器或主机运行: npm install @browserbasehq/stagehand playwright',
    );
  }

  const instance = new mod.Stagehand({
    env: 'LOCAL',
    headless: true,
    enableCaching: true,
  });

  await instance.init();
  try {
    return await fn(instance);
  } finally {
    try { await instance.close(); } catch { /* swallow close errors */ }
  }
}

export interface ComputerUseBrowseInput {
  url: string;
  action: string;
  screenshot?: boolean;
}

export interface ComputerUseBrowseResult {
  ok: boolean;
  action_result?: { success: boolean; message?: string };
  page_url?: string;
  page_title?: string;
  screenshot?: string;
  error?: string;
}

export interface ComputerUseScreenshotInput {
  url: string;
  full_page?: boolean;
  observe?: boolean;
}

export interface ComputerUseScreenshotResult {
  ok: boolean;
  screenshot?: string;
  page_url?: string;
  page_title?: string;
  elements?: Array<{ description: string; selector: string }>;
  error?: string;
}

export interface ComputerUseFillFormInput {
  url: string;
  fields: Record<string, string>;
  submit?: boolean;
}

export interface ComputerUseFillFormResult {
  ok: boolean;
  results?: Array<{ field: string; success: boolean; message?: string }>;
  page_url?: string;
  screenshot?: string;
  error?: string;
}

export function createComputerUseModule() {
  return {
    async browse(input: ComputerUseBrowseInput): Promise<ComputerUseBrowseResult> {
      const url = (input.url ?? '').toString();
      const action = (input.action ?? '').toString();
      const takeScreenshot = input.screenshot !== false;

      if (!url || !action) {
        return { ok: false, error: 'url 和 action 都是必填' };
      }

      try {
        return await withBrowser(async (browser) => {
          await browser.page.goto(url);
          const actionResult = await browser.act(action);

          let screenshotPath: string | undefined;
          if (takeScreenshot) {
            ensureScreenshotDir();
            const filename = `sdk-browse-${Date.now()}.png`;
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
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async screenshot(input: ComputerUseScreenshotInput): Promise<ComputerUseScreenshotResult> {
      const url = (input.url ?? '').toString();
      const fullPage = Boolean(input.full_page);
      const doObserve = Boolean(input.observe);

      if (!url) return { ok: false, error: 'url 必填' };

      try {
        return await withBrowser(async (browser) => {
          await browser.page.goto(url);
          ensureScreenshotDir();
          const filename = `sdk-screenshot-${Date.now()}.png`;
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
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async fillForm(input: ComputerUseFillFormInput): Promise<ComputerUseFillFormResult> {
      const url = (input.url ?? '').toString();
      const fields = input.fields;
      const submit = Boolean(input.submit);

      if (!url || !fields || typeof fields !== 'object') {
        return { ok: false, error: 'url 和 fields 都是必填' };
      }

      try {
        return await withBrowser(async (browser) => {
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
          const filename = `sdk-form-${Date.now()}.png`;
          const screenshotPath = join(SCREENSHOT_DIR, filename);
          await browser.page.screenshot({ path: screenshotPath });

          return {
            ok: true,
            results,
            page_url: browser.page.url(),
            screenshot: screenshotPath,
          };
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export type ComputerUseModule = ReturnType<typeof createComputerUseModule>;
