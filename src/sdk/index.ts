/**
 * PolarClaw SDK — server-side entry point
 *
 * Assembles all SDK modules into a single facade used by the
 * PolarClaw HTTP API layer and internal consumers. External projects
 * use the thin `polarclaw-project-sdk` HTTP client instead.
 */

import type { PolarUserRegistry } from '../core/polar-user.js';
import type { PilotStore } from '../adapters/pilot/store.js';
import type Database from 'better-sqlite3';
import { createUsersModule } from './users.js';
import { createEventsModule } from './events.js';
import { createLobstersModule } from './lobsters.js';
import { createTargetsModule } from './targets.js';
import { createApprovalsModule } from './approvals.js';
import { SDK_VERSION } from './types.js';

export interface PolarClawSDKConfig {
  userRegistry: PolarUserRegistry;
  pilotStore: PilotStore;
  pilotDb: Database.Database;
  /** SOTAgent base URL */
  sotAgentUrl?: string;
  /** Path to lobster-events.jsonl (local fallback) */
  localEventsPath: string;
  /** Polarisor root directory (parent of project dirs) */
  polarisorRoot: string;
}

export function createPolarClawSDK(config: PolarClawSDKConfig) {
  const users = createUsersModule({ registry: config.userRegistry });

  const targets = createTargetsModule({ polarisorRoot: config.polarisorRoot });

  const events = createEventsModule({
    sotAgentUrl: config.sotAgentUrl,
    localEventsPath: config.localEventsPath,
  });

  const lobsters = createLobstersModule({
    pilotStore: config.pilotStore,
    events,
    targets,
  });

  const approvals = createApprovalsModule({ db: config.pilotDb });

  return {
    version: SDK_VERSION,
    users,
    events,
    lobsters,
    targets,
    approvals,
  };
}

export type PolarClawSDK = ReturnType<typeof createPolarClawSDK>;

// Re-export types for consumers
export { SDK_VERSION, SDKError } from './types.js';
export type {
  PolarUserInfo,
  ResolveUserResult,
  LobsterEvent,
  LobsterEventType,
  EventSeverity,
  EmitEventResult,
  LobsterStatus,
  LobsterState,
  Target,
  TargetCreateInput,
  TargetUpdateInput,
  ArrowLogEntry,
  RunTestResult,
  ApprovalRequest,
  ApprovalCallbackPayload,
  ApprovalStatus,
  SDKErrorCode,
  SDKClientConfig,
} from './types.js';

/** @deprecated Use PolarClawSDK — alias kept for backward compatibility */
export type MyClawSDK = PolarClawSDK;
/** @deprecated Use createPolarClawSDK */
export const createMyClawSDK = createPolarClawSDK;
