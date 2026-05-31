export type AlwaysOnTriggerConfig = {
  enabled: boolean;
  tickIntervalMinutes: number;
  cooldownMinutes: number;
  dailyBudget: number;
  heartbeatStaleSeconds: number;
  recentUserMsgMinutes: number;
  preferChannel: string;
};

export type AlwaysOnDormancyConfig = {
  enabled: boolean;
  debounceMs: number;
  ignoreGlobs: string[];
};

export type AlwaysOnProjectConfig = {
  enabled: boolean;
  execute?: boolean;
};

export type AlwaysOnExecuteConfig = {
  enabled: boolean;
};

export type AlwaysOnConfig = {
  enabled: boolean;
  language?: 'en' | 'zh-CN';
  trigger: AlwaysOnTriggerConfig;
  dormancy: AlwaysOnDormancyConfig;
  execute: AlwaysOnExecuteConfig;
  projects: Record<string, AlwaysOnProjectConfig>;
};

export function defaultAlwaysOnConfig(): AlwaysOnConfig {
  return {
    enabled: false,
    trigger: {
      enabled: false,
      tickIntervalMinutes: 5,
      cooldownMinutes: 60,
      dailyBudget: 4,
      heartbeatStaleSeconds: 90,
      recentUserMsgMinutes: 5,
      preferChannel: 'web',
    },
    dormancy: {
      enabled: true,
      debounceMs: 2000,
      ignoreGlobs: [
        '**/.git/**',
        '**/.polarclaw/**',
        '**/.polarclaw-always-on/**',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
    execute: {
      enabled: false,
    },
    projects: {},
  };
}
