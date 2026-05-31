import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { RouteTier } from './classifyAndRoute.js';

const STATS_PATH =
  process.env.POLARCLAW_ROUTER_STATS ??
  resolve(homedir(), '.polarclaw', 'stats', 'sessions.jsonl');

export type TokenStatEntry = {
  ts: string;
  sessionKey: string;
  tier: RouteTier;
  capability: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  channel?: string;
};

export class TokenStatsCollector {
  constructor(private readonly path = STATS_PATH) {}

  record(entry: Omit<TokenStatEntry, 'ts'>): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(
      this.path,
      JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n',
      'utf-8',
    );
  }
}

let defaultCollector: TokenStatsCollector | null = null;

export function getTokenStatsCollector(): TokenStatsCollector {
  if (!defaultCollector) defaultCollector = new TokenStatsCollector();
  return defaultCollector;
}

export function recordTokenStats(entry: Omit<TokenStatEntry, 'ts'>): void {
  getTokenStatsCollector().record(entry);
}
