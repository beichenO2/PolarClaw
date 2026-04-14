import type { AutomationPreset, GsdConfig, InterventionBehavior, InterventionMatrix } from '../types.js';

function all(behavior: InterventionBehavior): InterventionMatrix {
  return {
    discuss: behavior,
    research: behavior,
    plan: behavior,
    execute: behavior,
    verify: behavior,
  };
}

export function interventionMatrixForPreset(preset: AutomationPreset): InterventionMatrix {
  if (preset === 'full_auto') {
    return all('auto');
  }
  if (preset === 'semi_auto') {
    return {
      discuss: 'auto',
      research: 'auto',
      plan: 'notify',
      execute: 'auto',
      verify: 'notify',
    };
  }
  return all('block');
}

export function defaultConfigForPreset(preset: AutomationPreset = 'full_auto'): GsdConfig {
  return {
    version: 0,
    automation_preset: preset,
    intervention_matrix: interventionMatrixForPreset(preset),
  };
}
