import type { GsdConfig, InterventionBehavior, WorkflowStage } from '../types.js';

export function behaviorForStage(config: GsdConfig, stage: WorkflowStage): InterventionBehavior {
  return config.intervention_matrix[stage];
}
