/**
 * SDK computer-use module — sandbox-external ComputerUse service
 *
 * Other Polarisor projects (Project Lobsters) call PolarClaw via the
 * thin polarclaw-project-sdk client; the corresponding server-side
 * module lives here. ComputerUse stays owned by PolarClaw — no other
 * project ever runs Chromium itself.
 *
 * Same module is reused by skills/computer-use/tools.ts so the in-
 * process ReAct agent and the SDK call site share a single Stagehand
 * adapter (no duplicate behaviour drifts).
 *
 * Stagehand v3 API surface (browserbasehq/stagehand@^3.x):
 *   - new Stagehand(opts): instance with init/close + act/observe/extract
 *   - stagehand.context.newPage(url?): Promise<Page>
 *   - stagehand.context.activePage(): Page | undefined
 *   - page.goto(url) / page.screenshot({path, fullPage}) / page.url() / page.title()
 *   - stagehand.observe(instruction?): Promise<Action[]>
 *
 * LLM routing (PolarPrivate by default):
 *   By default we send Stagehand's internal LLM calls through
 *   PolarPrivate's OpenAI-compatible /v1 gateway, so no external
 *   OPENAI_API_KEY is required and all traffic stays inside the
 *   Polarisor network. Override via env vars when needed.
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

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

/**
 * Build the ModelConfiguration object Stagehand v3 consumes.
 *
 * Resolution order:
 *   1. COMPUTER_USE_LLM_BASE_URL / COMPUTER_USE_LLM_API_KEY /
 *      COMPUTER_USE_MODEL_NAME — explicit override.
 *   2. POLARCLAW_LLM_BASE_URL / POLARCLAW_LLM_API_KEY — reuse PolarClaw's
 *      LLM env (which already points at PolarPrivate by default).
 *   3. POLARPRIVATE_URL + 'proxy-managed' — talk to PolarPrivate
 *      directly with the PolarClaw-wide convention.
 *
 * Default modelName 'gpt-4.1-mini' is picked to stay inside Stagehand's
 * AvailableModel literal and to make ai-sdk pick the openai provider —
 * the actual model served behind PolarPrivate is whatever PolarPrivate
 * routes /v1/chat/completions to.
 */
function resolveModelConfig() {
  const polarPrivateUrl = envOr('POLARPRIVATE_URL', 'http://127.0.0.1:12790');
  const baseURL = envOr(
    'COMPUTER_USE_LLM_BASE_URL',
    envOr('POLARCLAW_LLM_BASE_URL', `${polarPrivateUrl}/v1`),
  );
  const apiKey = envOr(
    'COMPUTER_USE_LLM_API_KEY',
    envOr('POLARCLAW_LLM_API_KEY', 'proxy-managed'),
  );
  // Stagehand v3 expects `provider/model` format; legacy bare names emit
  // a deprecation warning. Stick with openai/* so ai-sdk picks the openai
  // provider and the request flows through baseURL above.
  const modelName = envOr('COMPUTER_USE_MODEL_NAME', 'openai/gpt-4o-mini');
  return { modelName, apiKey, baseURL };
}

interface StagehandPage {
  goto(url: string, opts?: { waitUntil?: string; timeoutMs?: number }): Promise<unknown>;
  screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  url(): string;
  title(): Promise<string>;
}

interface StagehandContext {
  newPage(url?: string): Promise<StagehandPage>;
  activePage(): StagehandPage | undefined;
}

interface StagehandInstance {
  init(): Promise<void>;
  context: StagehandContext;
  act(instruction: string, opts?: Record<string, unknown>): Promise<{ success: boolean; message?: string }>;
  observe(instruction?: string, opts?: Record<string, unknown>): Promise<Array<{ description?: string; selector?: string }>>;
  close(opts?: { force?: boolean }): Promise<void>;
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
    localBrowserLaunchOptions: { headless: true },
    model: resolveModelConfig(),
    verbose: 0,
    disablePino: true,
  });

  await instance.init();
  try {
    return await fn(instance);
  } finally {
    try { await instance.close({ force: true }); } catch { /* swallow close errors */ }
  }
}

/**
 * Acquire a Page in v3 — newPage() each call ensures the URL is loaded
 * even on the first invocation; v3 does not auto-create a page.
 */
async function ensurePage(stagehand: StagehandInstance, url: string): Promise<StagehandPage> {
  const existing = stagehand.context.activePage();
  if (existing) {
    await existing.goto(url);
    return existing;
  }
  return stagehand.context.newPage(url);
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
  elements?: Array<{ description?: string; selector?: string }>;
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

export async function browse(input: ComputerUseBrowseInput): Promise<ComputerUseBrowseResult> {
  const url = (input.url ?? '').toString();
  const action = (input.action ?? '').toString();
  const takeScreenshot = input.screenshot !== false;

  if (!url || !action) {
    return { ok: false, error: 'url 和 action 都是必填' };
  }

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      const actionResult = await stagehand.act(action);

      let screenshotPath: string | undefined;
      if (takeScreenshot) {
        ensureScreenshotDir();
        const filename = `cu-browse-${Date.now()}.png`;
        screenshotPath = join(SCREENSHOT_DIR, filename);
        await page.screenshot({ path: screenshotPath });
      }

      return {
        ok: true,
        action_result: actionResult,
        page_url: page.url(),
        page_title: await page.title(),
        screenshot: screenshotPath,
      };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function screenshot(input: ComputerUseScreenshotInput): Promise<ComputerUseScreenshotResult> {
  const url = (input.url ?? '').toString();
  const fullPage = Boolean(input.full_page);
  const doObserve = Boolean(input.observe);

  if (!url) return { ok: false, error: 'url 必填' };

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      ensureScreenshotDir();
      const filename = `cu-screenshot-${Date.now()}.png`;
      const screenshotPath = join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: screenshotPath, fullPage });

      let elements: Array<{ description?: string; selector?: string }> | undefined;
      if (doObserve) {
        elements = await stagehand.observe('列出页面上所有可交互元素');
      }

      return {
        ok: true,
        screenshot: screenshotPath,
        page_url: page.url(),
        page_title: await page.title(),
        elements,
      };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fillForm(input: ComputerUseFillFormInput): Promise<ComputerUseFillFormResult> {
  const url = (input.url ?? '').toString();
  const fields = input.fields;
  const submit = Boolean(input.submit);

  if (!url || !fields || typeof fields !== 'object') {
    return { ok: false, error: 'url 和 fields 都是必填' };
  }

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      const results: Array<{ field: string; success: boolean; message?: string }> = [];

      for (const [fieldDesc, value] of Object.entries(fields)) {
        const r = await stagehand.act(`在"${fieldDesc}"字段中输入"${value}"`);
        results.push({ field: fieldDesc, success: r.success, message: r.message });
      }

      if (submit) {
        const submitResult = await stagehand.act('点击提交按钮或确认按钮');
        results.push({ field: '__submit__', success: submitResult.success, message: submitResult.message });
      }

      ensureScreenshotDir();
      const filename = `cu-form-${Date.now()}.png`;
      const screenshotPath = join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: screenshotPath });

      return {
        ok: true,
        results,
        page_url: page.url(),
        screenshot: screenshotPath,
      };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Lightweight screenshot path that does NOT invoke the LLM — used for
 * smoke tests and for the SDK screenshot route when observe=false. It
 * still launches stagehand (because that is how Chromium is owned) but
 * never calls act/observe, so no LLM credentials are needed for plain
 * screenshots. The `screenshot()` function above already covers this
 * by gating observe behind a flag — keep this as a behaviour note.
 */

export function createComputerUseModule() {
  return {
    browse,
    screenshot,
    fillForm,
  };
}

export type ComputerUseModule = ReturnType<typeof createComputerUseModule>;
