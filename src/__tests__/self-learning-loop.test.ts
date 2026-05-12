import { describe, it, expect, vi } from 'vitest';
import { createSelfLearningLoop, type SelfLearningLoopConfig } from '../adapters/learning/self-learning-loop.js';
import type { ILearningStore, IToolPattern } from '../ports/learning.js';
import type { ISkillRegistry, ISkillMeta } from '../ports/skills.js';

function createMockLearningStore(overrides: Partial<ILearningStore> = {}): ILearningStore {
  return {
    findPatterns: vi.fn(() => []),
    getSkillUseCount: vi.fn(() => 0),
    recordPattern: vi.fn(),
    recordSkillUse: vi.fn(),
    ...overrides,
  };
}

function createMockSkillRegistry(skills: ISkillMeta[] = []): ISkillRegistry {
  const skillMap = new Map(skills.map(s => [s.name, s]));
  return {
    getSkill: vi.fn((name: string) => skillMap.get(name) ?? null),
    listSkills: vi.fn(() => Array.from(skillMap.values())),
    registerSkill: vi.fn(),
    unregisterSkill: vi.fn(),
  };
}

const samplePatterns: IToolPattern[] = [
  { name: 'Search-Then-Read', trigger: 'knowlever_search → doc_reader', occurrences: 7, lastSeenAt: new Date().toISOString() },
  { name: 'Debug-Loop', trigger: 'shell_exec → code_search → shell_exec', occurrences: 3, lastSeenAt: new Date().toISOString() },
];

describe('Self-Learning Loop', () => {
  it('analyzeUsagePatterns returns patterns above threshold', () => {
    const store = createMockLearningStore({
      findPatterns: vi.fn((threshold: number) => samplePatterns.filter(p => p.occurrences >= threshold)),
    });
    const registry = createMockSkillRegistry();

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
      patternThreshold: 5,
    });

    const patterns = loop.analyzeUsagePatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.name).toBe('Search-Then-Read');
  });

  it('generateCandidateSkill creates meta for new pattern', () => {
    const store = createMockLearningStore();
    const registry = createMockSkillRegistry();

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
    });

    const meta = loop.generateCandidateSkill(samplePatterns[0]!);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('auto-search-then-read');
    expect(meta!.origin).toBe('generated');
    expect(meta!.status).toBe('draft');
  });

  it('generateCandidateSkill returns existing skill if already registered', () => {
    const existing: ISkillMeta = {
      name: 'auto-search-then-read',
      description: 'existing',
      version: '1.0.0',
      path: '/skills/auto-search-then-read',
      origin: 'generated',
      status: 'verified',
      successfulUses: 5,
      createdAt: new Date().toISOString(),
    };
    const store = createMockLearningStore();
    const registry = createMockSkillRegistry([existing]);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
    });

    const meta = loop.generateCandidateSkill(samplePatterns[0]!);
    expect(meta!.status).toBe('verified');
  });

  it('promoteCandidateSkill promotes when use count meets threshold', () => {
    const draftSkill: ISkillMeta = {
      name: 'auto-search-then-read',
      description: 'draft',
      version: '0.1.0',
      path: '',
      origin: 'generated',
      status: 'draft',
      successfulUses: 0,
      createdAt: new Date().toISOString(),
    };
    const store = createMockLearningStore({
      getSkillUseCount: vi.fn(() => 4),
    });
    const registry = createMockSkillRegistry([draftSkill]);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
      promotionThreshold: 3,
    });

    const result = loop.promoteCandidateSkill('auto-search-then-read');
    expect(result).toBe(true);
    expect(draftSkill.status).toBe('verified');
    expect(draftSkill.successfulUses).toBe(4);
  });

  it('promoteCandidateSkill does not promote when use count is below threshold', () => {
    const draftSkill: ISkillMeta = {
      name: 'auto-search-then-read',
      description: 'draft',
      version: '0.1.0',
      path: '',
      origin: 'generated',
      status: 'draft',
      successfulUses: 0,
      createdAt: new Date().toISOString(),
    };
    const store = createMockLearningStore({
      getSkillUseCount: vi.fn(() => 1),
    });
    const registry = createMockSkillRegistry([draftSkill]);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
      promotionThreshold: 3,
    });

    const result = loop.promoteCandidateSkill('auto-search-then-read');
    expect(result).toBe(false);
    expect(draftSkill.status).toBe('draft');
  });

  it('demoteSkill demotes generated skills but not static ones', () => {
    const generatedSkill: ISkillMeta = {
      name: 'auto-foo',
      description: 'generated',
      version: '1.0.0',
      path: '',
      origin: 'generated',
      status: 'verified',
      successfulUses: 5,
      createdAt: new Date().toISOString(),
    };
    const staticSkill: ISkillMeta = {
      name: 'static-bar',
      description: 'static',
      version: '1.0.0',
      path: '',
      origin: 'static',
      status: 'verified',
      successfulUses: 10,
      createdAt: new Date().toISOString(),
    };
    const store = createMockLearningStore();
    const registry = createMockSkillRegistry([generatedSkill, staticSkill]);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
    });

    expect(loop.demoteSkill('auto-foo', 'too many failures')).toBe(true);
    expect(generatedSkill.status).toBe('draft');

    expect(loop.demoteSkill('static-bar', 'too many failures')).toBe(false);
    expect(staticSkill.status).toBe('verified');
  });

  it('runCycle returns correct summary', () => {
    const store = createMockLearningStore({
      findPatterns: vi.fn(() => [samplePatterns[0]!]),
      getSkillUseCount: vi.fn(() => 4),
    });
    const draftSkill: ISkillMeta = {
      name: 'auto-search-then-read',
      description: 'draft',
      version: '0.1.0',
      path: '',
      origin: 'generated',
      status: 'draft',
      successfulUses: 0,
      createdAt: new Date().toISOString(),
    };
    const registry = createMockSkillRegistry([draftSkill]);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
      promotionThreshold: 3,
    });

    const result = loop.runCycle();
    expect(result.patternsDetected).toBe(1);
    expect(result.skillsGenerated).toBe(1); // pattern → candidate meta
    expect(result.skillsPromoted).toBe(1); // draft → verified
  });

  it('getHealthReport provides recommendations', () => {
    const skills: ISkillMeta[] = [
      { name: 'static-skill', description: 'static', version: '1.0.0', path: '', origin: 'static', status: 'verified', successfulUses: 10, createdAt: new Date().toISOString() },
      { name: 'draft-promotable', description: 'promotable', version: '0.1.0', path: '', origin: 'generated', status: 'draft', successfulUses: 0, createdAt: new Date().toISOString() },
      { name: 'draft-unused', description: 'unused', version: '0.1.0', path: '', origin: 'generated', status: 'draft', successfulUses: 0, createdAt: new Date().toISOString() },
    ];
    const store = createMockLearningStore({
      getSkillUseCount: vi.fn((name: string) => {
        if (name === 'draft-promotable') return 5;
        return 0;
      }),
    });
    const registry = createMockSkillRegistry(skills);

    const loop = createSelfLearningLoop({
      learningStore: store,
      skillRegistry: registry,
      promotionThreshold: 3,
    });

    const report = loop.getHealthReport();
    expect(report.length).toBe(3);

    const staticEntry = report.find(r => r.skillName === 'static-skill')!;
    expect(staticEntry.recommendation).toBe('keep');

    const promotable = report.find(r => r.skillName === 'draft-promotable')!;
    expect(promotable.recommendation).toBe('promote');

    const unused = report.find(r => r.skillName === 'draft-unused')!;
    expect(unused.recommendation).toBe('delete');
  });
});