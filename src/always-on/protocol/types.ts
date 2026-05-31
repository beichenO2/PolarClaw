export type AlwaysOnDiscoveryOutcome = 'executed' | 'no_plan' | 'failed' | 'aborted';

export type AlwaysOnDormantState = {
  since: string;
  lastBaselineAt: string;
  lastChangeAt?: string;
};

export type AlwaysOnDiscoveryState = {
  schemaVersion: 1;
  lastFireStartedAt?: string;
  lastFireCompletedAt?: string;
  lastFireOutcome?: AlwaysOnDiscoveryOutcome;
  lastPlanId?: string;
  lastRunId?: string;
  todayKey: string;
  todayRunCount: number;
  consecutiveFailures: number;
  dormant?: AlwaysOnDormantState;
  activeWorkCycleId?: string;
};

export type AlwaysOnChannelLease = {
  schemaVersion: 1;
  channelKey: string;
  writerId: string;
  projectKey: string;
  sessionKey: string;
  writtenAt: string;
  agentBusy: boolean;
  lastUserMsgAt?: string | null;
};

export type GateBlockReason =
  | 'disabled'
  | 'project_disabled'
  | 'project_missing'
  | 'dormant_no_signal'
  | 'agent_busy'
  | 'recent_user_msg'
  | 'cooldown'
  | 'daily_budget'
  | 'lock_busy';

export type GateResult =
  | { ok: true; lease?: AlwaysOnChannelLease }
  | { ok: false; reason: GateBlockReason };
