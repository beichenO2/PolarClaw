import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { defaultAlwaysOnConfig, type AlwaysOnConfig } from './defaults.js';

const POLARCLAW_HOME = process.env.POLARCLAW_HOME ?? resolve(homedir(), '.polarclaw');

export function resolvePolarHome(): string {
  return POLARCLAW_HOME;
}

/** Minimal YAML subset parser for alwaysOn block (no external dep). */
function parseAlwaysOnYamlBlock(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  let inBlock = false;
  let baseIndent = -1;
  const blockLines: string[] = [];

  for (const raw of lines) {
    if (!inBlock) {
      if (/^alwaysOn\s*:/.test(raw.trim())) {
        inBlock = true;
        baseIndent = raw.search(/\S/);
        continue;
      }
      continue;
    }
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      blockLines.push(raw);
      continue;
    }
    const indent = raw.search(/\S/);
    if (indent <= baseIndent && raw.trim()) break;
    blockLines.push(raw);
  }

  if (blockLines.length === 0) return null;
  return parseIndentedYaml(blockLines.join('\n'));
}

function parseIndentedYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.search(/\S/);
    const content = line.trim();
    const colon = content.indexOf(':');
    if (colon <= 0) continue;
    const key = content.slice(0, colon).trim();
    let value = content.slice(colon + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.obj;

    if (value === '' || value === '|' || value === '>') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else if (value === 'true' || value === 'false') {
      parent[key] = value === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      parent[key] = Number(value);
    } else {
      parent[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return root;
}

function mergeTrigger(
  base: AlwaysOnConfig['trigger'],
  patch?: Record<string, unknown>,
): AlwaysOnConfig['trigger'] {
  if (!patch) return base;
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    tickIntervalMinutes: num(patch.tickIntervalMinutes, base.tickIntervalMinutes),
    cooldownMinutes: num(patch.cooldownMinutes, base.cooldownMinutes),
    dailyBudget: num(patch.dailyBudget, base.dailyBudget),
    heartbeatStaleSeconds: num(patch.heartbeatStaleSeconds, base.heartbeatStaleSeconds),
    recentUserMsgMinutes: num(patch.recentUserMsgMinutes, base.recentUserMsgMinutes),
    preferChannel: str(patch.preferChannel, base.preferChannel),
  };
}

function mergeDormancy(
  base: AlwaysOnConfig['dormancy'],
  patch?: Record<string, unknown>,
): AlwaysOnConfig['dormancy'] {
  if (!patch) return base;
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    debounceMs: num(patch.debounceMs, base.debounceMs),
    ignoreGlobs: Array.isArray(patch.ignoreGlobs)
      ? patch.ignoreGlobs.map(String)
      : base.ignoreGlobs,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function mergeExecute(
  base: AlwaysOnConfig['execute'],
  patch?: Record<string, unknown>,
): AlwaysOnConfig['execute'] {
  if (!patch) return base;
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
  };
}

function mergeProjects(
  base: AlwaysOnConfig['projects'],
  patch?: Record<string, unknown>,
): AlwaysOnConfig['projects'] {
  if (!patch) return base;
  const out = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    const enabled = typeof val === 'object' && val !== null && 'enabled' in val
      ? Boolean((val as { enabled?: boolean }).enabled)
      : true;
    out[resolve(key)] = { enabled };
  }
  return out;
}

function applyEnvOverrides(config: AlwaysOnConfig): AlwaysOnConfig {
  const envOn = process.env.POLARCLAW_ALWAYS_ON?.trim();
  if (envOn === '1' || envOn === 'true') {
    config.enabled = true;
    config.trigger.enabled = true;
  }
  const execOn = process.env.POLARCLAW_ALWAYS_ON_EXECUTE?.trim();
  if (execOn === '1' || execOn === 'true') {
    config.execute.enabled = true;
  }
  const tick = process.env.POLARCLAW_ALWAYS_ON_TICK_MIN?.trim();
  if (tick) config.trigger.tickIntervalMinutes = Number(tick) || config.trigger.tickIntervalMinutes;
  const projects = process.env.POLARCLAW_ALWAYS_ON_PROJECTS?.trim();
  if (projects) {
    for (const p of projects.split(',').map((s) => s.trim()).filter(Boolean)) {
      config.projects[resolve(p)] = { enabled: true };
    }
  }
  return config;
}

export function parseAlwaysOnConfig(polarHome = POLARCLAW_HOME): AlwaysOnConfig {
  const config = defaultAlwaysOnConfig();

  const jsonPath = resolve(polarHome, 'always-on.json');
  if (existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Partial<AlwaysOnConfig>;
      if (typeof parsed.enabled === 'boolean') config.enabled = parsed.enabled;
      if (parsed.language) config.language = parsed.language;
      config.trigger = mergeTrigger(config.trigger, parsed.trigger as Record<string, unknown>);
      config.dormancy = mergeDormancy(config.dormancy, parsed.dormancy as Record<string, unknown>);
      config.execute = mergeExecute(config.execute, parsed.execute as Record<string, unknown>);
      config.projects = mergeProjects(config.projects, parsed.projects as Record<string, unknown>);
    } catch {
      // ignore corrupt json
    }
  }

  const yamlPath = resolve(polarHome, 'polarclaw.yaml');
  if (existsSync(yamlPath)) {
    try {
      const block = parseAlwaysOnYamlBlock(readFileSync(yamlPath, 'utf-8'));
      if (block) {
        if (typeof block.enabled === 'boolean') config.enabled = block.enabled;
        if (block.language === 'en' || block.language === 'zh-CN') {
          config.language = block.language;
        }
        config.trigger = mergeTrigger(config.trigger, block.trigger as Record<string, unknown>);
        config.dormancy = mergeDormancy(config.dormancy, block.dormancy as Record<string, unknown>);
        config.execute = mergeExecute(config.execute, block.execute as Record<string, unknown>);
        config.projects = mergeProjects(config.projects, block.projects as Record<string, unknown>);
      }
    } catch {
      // ignore yaml parse errors
    }
  }

  return applyEnvOverrides(config);
}
