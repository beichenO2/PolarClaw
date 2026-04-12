/** Outcome-first card — hides plumbing, shows user value (REQ-031). */
export type OutcomeHighlight = {
  id: string;
  title: string;
  summary: string;
  metric?: string;
};

/** Evolution direction & wins (REQ-032). */
export type EvolutionItem = {
  id: string;
  direction: string;
  lastWin: string;
  status: 'active' | 'paused' | 'done';
};

/** Kanban-style task (REQ-033). */
export type BoardTask = {
  id: string;
  title: string;
  column: 'backlog' | 'doing' | 'done';
  module?: string;
};

/** Research artifact for visualization (REQ-034). */
export type ResearchSection = {
  heading: string;
  bullets: string[];
  confidence: 'high' | 'medium' | 'low';
};
