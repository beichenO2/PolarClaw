import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Entry types for PolarClaw
 *
 * - feishu: Feishu/Lark bot integration (全能助手)
 * - web: Web Dashboard (Product Manager Assistant)
 * - cli: Command-line interface (can simulate web via --mode)
 * - api: HTTP API calls (same as web)
 */
export type EntryType = 'feishu' | 'cli' | 'web' | 'api';

/**
 * CLI simulation mode for --mode parameter
 */
export type CLISimulationMode = 'web';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

const promptCache = new Map<string, string>();

function loadPromptFile(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached) return cached;

  try {
    const content = readFileSync(join(PROMPTS_DIR, filename), 'utf-8');
    promptCache.set(filename, content);
    return content;
  } catch {
    return '';
  }
}

/**
 * Map entry types to their prompt template files.
 *
 * - feishu: entry-feishu.md (全能助手)
 * - web: entry-web.md (Product Manager Assistant)
 * - cli: Uses cliSimulationMode to determine template (default: web)
 * - api: entry-web.md (same as web)
 */
const ENTRY_PROMPT_MAP: Record<Exclude<EntryType, 'cli'>, string> = {
  feishu: 'entry-feishu.md',
  web: 'entry-web.md',
  api: 'entry-web.md',
};

/**
 * CLI simulation mode storage (set via --mode parameter)
 */
let cliSimulationMode: CLISimulationMode = 'web';

/**
 * Set CLI simulation mode for --mode parameter support
 */
export function setCLISimulationMode(mode: CLISimulationMode): void {
  cliSimulationMode = mode;
}

/**
 * Get current CLI simulation mode
 */
export function getCLISimulationMode(): CLISimulationMode {
  return cliSimulationMode;
}

/**
 * Detect entry point from message context.
 *
 * Detection heuristic:
 *   - channel === 'feishu' or source contains feishu identifiers → feishu
 *   - channel === 'web' or source contains 'web' → web
 *   - channel === 'cli' or source is TTY → cli (uses simulation mode)
 *   - everything else (HTTP API calls) → api
 */
export function detectEntryPoint(context: {
  channel?: string;
  source?: string;
}): EntryType {
  const ch = (context.channel ?? '').toLowerCase();
  const src = (context.source ?? '').toLowerCase();

  if (ch === 'feishu' || src.includes('feishu') || src.includes('lark')) {
    return 'feishu';
  }
  if (ch === 'web' || src.includes('web') || src.includes('dashboard')) {
    return 'web';
  }
  if (ch === 'cli' || src.includes('tty') || src.includes('cli')) {
    return 'cli';
  }
  return 'api';
}

/**
 * Load entry prompt for the given entry type.
 * For CLI entry, uses the current simulation mode.
 */
export function loadEntryPrompt(entryType: EntryType): string {
  if (entryType === 'cli') {
    const file = ENTRY_PROMPT_MAP[cliSimulationMode];
    return loadPromptFile(file);
  }
  const file = ENTRY_PROMPT_MAP[entryType];
  return loadPromptFile(file);
}

/**
 * Get the actual entry type being used for prompt loading.
 * For CLI, returns the simulated entry type based on --mode.
 */
export function getEffectiveEntryType(entryType: EntryType): Exclude<EntryType, 'cli'> {
  if (entryType === 'cli') {
    return cliSimulationMode;
  }
  return entryType;
}

/**
 * Main export for llm-router integration.
 * Returns the entry-specific system prompt to append via PolarPrivate.
 */
export function getAppendSystemPrompt(context: {
  channel?: string;
  source?: string;
}): string {
  const entry = detectEntryPoint(context);
  return loadEntryPrompt(entry);
}

export function clearPromptCache(): void {
  promptCache.clear();
}
