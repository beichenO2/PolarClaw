/**
 * Self-Learning Loop — 自进化闭环控制器
 *
 * 完整闭环：工具使用追踪 → 模式检测 → 候选技能生成 → 晋升/降级
 * Curator：后台巡检（7天周期），评分/合并/清理技能库，生成 REPORT.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ILearningStore, IToolPattern } from '../../ports/learning.js';
import type { ISkillRegistry } from '../../ports/skills.js';
import { createSkillGenerator } from './skill-generator.js';

export interface ISelfLearningLoopConfig {
  skillsDir: string;
  candidatesDir: string;
  patternThreshold: number;
  promotionThreshold: number;
  demotionThreshold: number;
  cycleIntervalMs: number;
  curatorCycleMs: number;
  curatorReportDir: string;
  curatorStaleDays: number;
  enabled: boolean;
}

export const DEFAULT_LOOP_CONFIG: ISelfLearningLoopConfig = {
  skillsDir: 'skills',
  candidatesDir: 'skills/_candidates',
  patternThreshold: 5,
  promotionThreshold: 3,
  demotionThreshold: 3,
  cycleIntervalMs: 60_000,
  curatorCycleMs: 7 * 24 * 3600 * 1000,
  curatorReportDir: 'logs/curator',
  curatorStaleDays: 30,
  enabled: true,
};

export interface ICandidateRecord {
  id: string;
  name: string;
  patternName: string;
  createdAt: string;
  successCount: number;
  failureCount: number;
  status: 'candidate' | 'promoted' | 'demoted';
  demotionReason?: string;
}

export interface ILoopCycleResult {
  patternsAnalyzed: number;
  candidatesGenerated: number;
  promotions: string[];
  demotions: Array<{ id: string; reason: string }>;
}

export interface ICuratorResult {
  evaluated: number;
  merged: number;
  cleaned: number;
  reportPath: string | null;
}

export interface ISelfLearningLoop {
  readonly config: ISelfLearningLoopConfig;
  analyzeUsagePatterns(): IToolPattern[];
  generateCandidateSkill(pattern: IToolPattern): ICandidateRecord | null;
  promoteCandidateSkill(skillId: string): boolean;
  demoteSkill(skillId: string, reason: string): boolean;
  runCycle(): ILoopCycleResult;
  runCuratorCycle(): ICuratorResult;
  getCandidates(): ICandidateRecord[];
  getCandidate(skillId: string): ICandidateRecord | undefined;
  start(): void;
  stop(): void;
}

export function createSelfLearningLoop(
  learningStore: ILearningStore,
  skillRegistry: ISkillRegistry,
  partialConfig?: Partial<ISelfLearningLoopConfig>,
): ISelfLearningLoop {
  const config: ISelfLearningLoopConfig = { ...DEFAULT_LOOP_CONFIG, ...partialConfig };
  const candidates = new Map<string, ICandidateRecord>();
  let cycleTimer: ReturnType<typeof setInterval> | null = null;
  let curatorTimer: ReturnType<typeof setInterval> | null = null;
  const skillGenerator = createSkillGenerator({ outputDir: config.candidatesDir });

  loadCandidatesFromDisk();

  function loadCandidatesFromDisk(): void {
    if (!existsSync(config.candidatesDir)) return;
    for (const entry of readdirSync(config.candidatesDir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(config.candidatesDir, entry), 'utf-8');
        const rec: ICandidateRecord = JSON.parse(raw);
        if (rec.status === 'candidate') candidates.set(rec.id, rec);
      } catch { /* skip */ }
    }
  }

  function persistCandidate(rec: ICandidateRecord): void {
    if (!existsSync(config.candidatesDir)) mkdirSync(config.candidatesDir, { recursive: true });
    writeFileSync(join(config.candidatesDir, `${rec.id}.json`), JSON.stringify(rec, null, 2));
  }

  function removeCandidateFile(id: string): void {
    const fp = join(config.candidatesDir, `${id}.json`);
    try { if (existsSync(fp)) unlinkSync(fp); } catch { /* ok */ }
  }

  function analyzeUsagePatterns(): IToolPattern[] {
    return learningStore.findPatterns(config.patternThreshold);
  }

  function generateCandidateSkill(pattern: IToolPattern): ICandidateRecord | null {
    const existing = Array.from(candidates.values()).find(
      c => c.patternName === pattern.name && c.status === 'candidate',
    );
    if (existing) return null;
    const generated = skillGenerator.generateFromPattern(pattern);
    if (!generated) return null;
    const rec: ICandidateRecord = {
      id: generated.meta.name, name: generated.meta.name, patternName: pattern.name,
      createdAt: new Date().toISOString(), successCount: 0, failureCount: 0, status: 'candidate',
    };
    candidates.set(rec.id, rec);
    persistCandidate(rec);
    return rec;
  }

  function promoteCandidateSkill(skillId: string): boolean {
    const rec = candidates.get(skillId);
    if (!rec || rec.status !== 'candidate') return false;
    const useCount = learningStore.getSkillUseCount(skillId);
    if (useCount < config.promotionThreshold) return false;
    const skill = skillRegistry.getSkill(skillId);
    if (skill) { skill.status = 'verified'; skill.successfulUses = useCount; }
    rec.status = 'promoted';
    removeCandidateFile(skillId);
    candidates.delete(skillId);
    return true;
  }

  function demoteSkill(skillId: string, reason: string): boolean {
    const rec = candidates.get(skillId);
    if (rec) {
      rec.status = 'demoted'; rec.demotionReason = reason;
      removeCandidateFile(skillId); candidates.delete(skillId);
      return true;
    }
    const skill = skillRegistry.getSkill(skillId);
    if (!skill || skill.origin === 'static') return false;
    skillRegistry.unloadSkill(skillId);
    skill.status = 'retired';
    return true;
  }

  function runCycle(): ILoopCycleResult {
    if (!config.enabled) return { patternsAnalyzed: 0, candidatesGenerated: 0, promotions: [], demotions: [] };
    const patterns = analyzeUsagePatterns();
    const result: ILoopCycleResult = { patternsAnalyzed: patterns.length, candidatesGenerated: 0, promotions: [], demotions: [] };
    for (const pattern of patterns) {
      const rec = generateCandidateSkill(pattern);
      if (rec) result.candidatesGenerated++;
    }
    for (const [id, rec] of candidates.entries()) {
      if (rec.status !== 'candidate') continue;
      const useCount = learningStore.getSkillUseCount(id);
      rec.successCount = useCount;
      if (useCount >= config.promotionThreshold) {
        if (promoteCandidateSkill(id)) result.promotions.push(id);
        continue;
      }
      const skill = skillRegistry.getSkill(id);
      if (skill?.toolNames?.length) {
        let failures = 0;
        for (const toolName of skill.toolNames) {
          const history = learningStore.getUsageHistory('anonymous', toolName, 50);
          failures += history.filter(r => !r.success).length;
        }
        rec.failureCount = failures;
        if (failures >= config.demotionThreshold) {
          if (demoteSkill(id, `Exceeded failure threshold (${failures} failures)`)) {
            result.demotions.push({ id, reason: `Exceeded failure threshold (${failures} failures)` });
            continue;
          }
        }
      }
      persistCandidate(rec);
    }
    return result;
  }

  /**
   * Curator 周期：评估所有技能、合并重复、清理过期。
   * 类似 Hermes 的 Autonomous Curator。
   */
  function runCuratorCycle(): ICuratorResult {
    if (!config.enabled) return { evaluated: 0, merged: 0, cleaned: 0, reportPath: null };

    const allSkills = skillRegistry.listSkills();
    const result: ICuratorResult = { evaluated: allSkills.length, merged: 0, cleaned: 0, reportPath: null };

    interface SkillScore {
      id: string;
      uses: number;
      lastUsed: string | null;
      status: string;
      origin: string;
      score: number;
    }

    const scored: SkillScore[] = allSkills.map(skill => {
      const uses = learningStore.getSkillUseCount(skill.name);
      const history = skill.toolNames?.length
        ? learningStore.getUsageHistory('anonymous', skill.toolNames[0]!, 1)
        : [];
      const lastUsed = history.length > 0 ? (history[0]!.createdAt ?? null) : null;
      const daysSinceUse = lastUsed
        ? (Date.now() - new Date(lastUsed).getTime()) / (24 * 3600 * 1000)
        : Infinity;
      const recency = daysSinceUse < 7 ? 3 : daysSinceUse < 30 ? 1 : 0;
      const score = uses * 2 + recency;
      return {
        id: skill.name,
        uses,
        lastUsed,
        status: skill.status ?? 'draft',
        origin: skill.origin ?? 'static',
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Merge: candidates with same pattern name → keep highest scored
    const patternGroups = new Map<string, ICandidateRecord[]>();
    for (const rec of candidates.values()) {
      if (rec.status !== 'candidate') continue;
      const group = patternGroups.get(rec.patternName) ?? [];
      group.push(rec);
      patternGroups.set(rec.patternName, group);
    }
    for (const [, group] of patternGroups) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.successCount - a.successCount);
      for (let i = 1; i < group.length; i++) {
        removeCandidateFile(group[i]!.id);
        candidates.delete(group[i]!.id);
        result.merged++;
      }
    }

    // Clean: stale skills (>N days unused + more failures than successes)
    const staleMs = config.curatorStaleDays * 24 * 3600 * 1000;
    for (const rec of Array.from(candidates.values())) {
      if (rec.status !== 'candidate') continue;
      const age = Date.now() - new Date(rec.createdAt).getTime();
      if (age > staleMs && rec.failureCount > rec.successCount) {
        demoteSkill(rec.id, `Curator: stale (${Math.round(age / (24 * 3600 * 1000))}d) with ${rec.failureCount}F > ${rec.successCount}S`);
        result.cleaned++;
      }
    }

    // Generate report
    try {
      if (!existsSync(config.curatorReportDir)) mkdirSync(config.curatorReportDir, { recursive: true });
      const now = new Date().toISOString().slice(0, 10);
      const reportPath = join(config.curatorReportDir, `REPORT-${now}.md`);

      const lines: string[] = [
        `# Curator Report — ${now}`,
        '',
        `## Summary`,
        `- Evaluated: ${result.evaluated} skills`,
        `- Merged: ${result.merged} duplicates`,
        `- Cleaned: ${result.cleaned} stale candidates`,
        `- Active candidates: ${getCandidates().length}`,
        '',
        `## Skill Rankings`,
        '',
        '| Rank | Skill | Uses | Last Used | Status | Score |',
        '|------|-------|------|-----------|--------|-------|',
      ];

      scored.slice(0, 20).forEach((s, i) => {
        lines.push(`| ${i + 1} | ${s.id} | ${s.uses} | ${s.lastUsed ?? 'never'} | ${s.status} | ${s.score.toFixed(1)} |`);
      });

      if (getCandidates().length > 0) {
        lines.push('', `## Candidates (${getCandidates().length})`);
        lines.push('', '| ID | Pattern | Created | Success | Failure |');
        lines.push('|----|---------|---------|---------|---------|');
        for (const c of getCandidates()) {
          lines.push(`| ${c.id} | ${c.patternName} | ${c.createdAt.slice(0, 10)} | ${c.successCount} | ${c.failureCount} |`);
        }
      }

      writeFileSync(reportPath, lines.join('\n') + '\n');
      result.reportPath = reportPath;
      console.error(`[Curator] Report → ${reportPath}`);
    } catch (e) {
      console.error(`[Curator] Failed to write report:`, e);
    }

    if (result.merged > 0 || result.cleaned > 0) {
      console.error(`[Curator] Evaluated ${result.evaluated}, merged ${result.merged}, cleaned ${result.cleaned}`);
    }

    return result;
  }

  function getCandidates(): ICandidateRecord[] {
    return Array.from(candidates.values()).filter(c => c.status === 'candidate');
  }

  function getCandidate(skillId: string): ICandidateRecord | undefined {
    return candidates.get(skillId);
  }

  function start(): void {
    if (!config.enabled || cycleTimer) return;
    cycleTimer = setInterval(() => { try { runCycle(); } catch { /* non-critical */ } }, config.cycleIntervalMs);
    curatorTimer = setInterval(() => { try { runCuratorCycle(); } catch { /* non-critical */ } }, config.curatorCycleMs);
    console.error(`[SelfLearning] Started — cycle ${config.cycleIntervalMs}ms, curator ${config.curatorCycleMs}ms`);
  }

  function stop(): void {
    if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
    if (curatorTimer) { clearInterval(curatorTimer); curatorTimer = null; }
  }

  return {
    config, analyzeUsagePatterns, generateCandidateSkill, promoteCandidateSkill,
    demoteSkill, runCycle, runCuratorCycle, getCandidates, getCandidate, start, stop,
  };
}
