import type { BoardTask, EvolutionItem, OutcomeHighlight, ResearchSection } from '../types';

export const mockOutcomes: OutcomeHighlight[] = [
  {
    id: 'o1',
    title: '本周交付',
    summary: '合并 3 项用户可见改进；无新增配置负担。',
    metric: '3 shipped',
  },
  {
    id: 'o2',
    title: '稳定性',
    summary: '关键路径错误率保持在目标以下。',
    metric: '< 0.1%',
  },
];

export const mockEvolution: EvolutionItem[] = [
  {
    id: 'e1',
    direction: 'Skill 自动生成管线',
    lastWin: '草稿 Skill 已落盘，待人审',
    status: 'active',
  },
  {
    id: 'e2',
    direction: '多模型路由',
    lastWin: '编码任务默认 Coder 模型',
    status: 'done',
  },
];

export const mockBoard: BoardTask[] = [
  { id: 't1', title: 'Gateway 健康检查', column: 'done', module: 'gateway' },
  { id: 't2', title: 'Dashboard 骨架', column: 'doing', module: 'web' },
  { id: 't3', title: '研究报告图表', column: 'backlog', module: 'research' },
];

export const mockResearch: ResearchSection[] = [
  {
    heading: '结论',
    bullets: ['主题 A 与目标一致', '风险 B 需下一轮验证'],
    confidence: 'high',
  },
  {
    heading: '证据',
    bullets: ['来源 1：官方文档', '来源 2：对照实验'],
    confidence: 'medium',
  },
];
