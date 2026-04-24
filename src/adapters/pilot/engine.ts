/**
 * PilotEngine — MyClaw's autonomous project execution system.
 *
 * "IO is All": user defines requirements, engine decomposes into phases
 * and drives execution via LLM Proxy with local memory management.
 */

import type { PilotStore, PilotPhase } from './store.js';
import type { ILLMRouter } from '../../ports/llm.js';

export interface PilotEngineConfig {
  store: PilotStore;
  llm: ILLMRouter;
}

export function parseInputSpec(inputSpec: string): PilotPhase[] {
  if (!inputSpec.trim()) return [];
  const lines = inputSpec.split('\n').map(l => l.trim()).filter(Boolean);
  const phases: PilotPhase[] = [];

  for (const line of lines) {
    const numbered = line.match(/^\d+[.)]\s*(.+)/);
    const bullet = line.match(/^[-*]\s*(.+)/);
    const content = numbered?.[1] ?? bullet?.[1] ?? line;
    if (content.startsWith('#') || content.startsWith('---')) continue;

    const colonIdx = content.indexOf(':');
    const name = colonIdx > 0 && colonIdx < 40
      ? content.slice(0, colonIdx).trim()
      : content.slice(0, 50).trim();
    const description = colonIdx > 0 && colonIdx < 40
      ? content.slice(colonIdx + 1).trim()
      : content;

    phases.push({ name, description, status: 'pending' });
  }
  return phases;
}

export function createPilotEngine(config: PilotEngineConfig) {
  const { store, llm } = config;

  async function parseWithLLM(inputSpec: string, outputSpec?: string): Promise<PilotPhase[]> {
    try {
      const systemPrompt = `You are a project decomposer. Given a requirements specification, break it into sequential phases.
Each phase should be an actionable development task that a coding agent can execute.
Respond ONLY with a JSON array of objects: [{"name": "...", "description": "...", "deliverables": ["..."]}]
Keep phase count between 2-8. Each phase should be completable in 1-4 hours.`;

      const userPrompt = `Requirements:\n${inputSpec}${outputSpec ? `\n\nExpected output:\n${outputSpec}` : ''}`;

      const result = await llm.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { maxTokens: 2000, temperature: 0.3 });

      const jsonMatch = (result.content ?? '').match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('no_json_in_response');

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        name: string; description: string; deliverables?: string[];
      }>;

      return parsed.map(p => ({
        name: p.name,
        description: p.description,
        status: 'pending' as const,
        deliverables: p.deliverables,
      }));
    } catch {
      return parseInputSpec(inputSpec);
    }
  }

  return {
    async start(projectId: string) {
      const project = store.get(projectId);
      if (!project) throw new Error('project_not_found');
      if (project.status !== 'draft' && project.status !== 'created') {
        throw new Error('project_already_started');
      }

      const llmPhases = await parseWithLLM(project.input_spec, project.output_spec);
      const phases = llmPhases.length > 0 ? llmPhases : parseInputSpec(project.input_spec);
      if (phases.length === 0) throw new Error('empty_input_spec');

      store.updatePhases(projectId, phases);
      store.updateStatus(projectId, 'running');

      return { phases, llm_used: llmPhases.some(p => p.deliverables && p.deliverables.length > 0) };
    },

    updatePhaseStatus(projectId: string, phaseIndex: number, status: PilotPhase['status'], agentId?: string, deliverables?: string[]) {
      const project = store.get(projectId);
      if (!project) throw new Error('project_not_found');

      const phases = [...project.phases];
      if (phaseIndex < 0 || phaseIndex >= phases.length) throw new Error('phase_index_out_of_range');

      phases[phaseIndex] = { ...phases[phaseIndex]!, status };
      if (agentId) phases[phaseIndex]!.agent_id = agentId;
      if (deliverables) phases[phaseIndex]!.deliverables = deliverables;

      store.updatePhases(projectId, phases);

      const allCompleted = phases.every(p => p.status === 'completed');
      if (allCompleted) store.updateStatus(projectId, 'completed');

      return { updated: true, projectCompleted: allCompleted };
    },

    cancel(projectId: string) {
      const project = store.get(projectId);
      if (!project) throw new Error('project_not_found');
      if (project.status === 'completed' || project.status === 'cancelled') {
        throw new Error('project_not_cancellable');
      }
      store.updateStatus(projectId, 'cancelled');
      return true;
    },

    assignAgents(projectId: string, agentIds: string[]) {
      const project = store.get(projectId);
      if (!project) throw new Error('project_not_found');
      const phases = [...project.phases];
      for (let i = 0; i < phases.length && i < agentIds.length; i++) {
        if (agentIds[i]) phases[i]!.agent_id = agentIds[i];
      }
      store.updatePhases(projectId, phases, agentIds);
      return phases;
    },
  };
}

export type PilotEngine = ReturnType<typeof createPilotEngine>;
