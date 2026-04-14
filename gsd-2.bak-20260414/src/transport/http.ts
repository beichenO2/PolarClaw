import { randomUUID } from 'node:crypto';
import express, { type Express, type RequestHandler } from 'express';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { BroadcastPublisher } from '../broadcast/publisher.js';
import type { SseHub } from '../broadcast/sse-hub.js';
import type { EventSubscriber } from '../broadcast/subscriber.js';
import { loadConfigFromDisk, updateConfigOnDisk } from '../config/loader.js';
import {
  hubPollEventsInputSchema,
  hubPublishInputSchema,
  hubSubscribeInputSchema,
} from '../protocol/broadcast.js';
import { hubStateReadInputSchema, hubStateWriteInputSchema } from '../protocol/state.js';
import {
  hubClaimTaskInputSchema,
  hubCompleteTaskInputSchema,
  hubCreateTaskInputSchema,
  hubHeartbeatTaskInputSchema,
  hubListTasksInputSchema,
  hubSplitTaskInputSchema,
} from '../protocol/tasks.js';
import { hubGetConfigInputSchema, hubUpdateConfigInputSchema } from '../protocol/config.js';
import {
  hubAcquireLeaseInputSchema,
  hubCheckLeaseInputSchema,
  hubReleaseLeaseInputSchema,
} from '../protocol/leases.js';
import type { HubAcquireLeaseOutput } from '../protocol/leases.js';
import {
  hubCheckpointInputSchema,
  hubHandoffInputSchema,
  hubReportProgressInputSchema,
  hubRequestHelpInputSchema,
} from '../protocol/agent.js';
import type { PathLeaseService } from '../persistence/path-leases.js';
import type { HubContext } from '../types.js';
import { HubStore } from '../persistence/store.js';
import { SessionRegistry } from '../session/registry.js';
import {
  hubGetAuditLogInputSchema,
  hubGetHealthInputSchema,
  hubGetProgressInputSchema,
  hubSetLimitsInputSchema,
} from '../protocol/safety.js';
import type { HubDb } from '../persistence/db.js';
import type { AuditJournal } from '../safety/audit.js';
import { buildHealthStatus } from '../safety/health.js';
import { buildProgressByPhase } from '../safety/progress.js';
import type { SafetyLimiter } from '../safety/limiter.js';
import type { ClkService } from '../roles/clk.js';
import type { RoleManager } from '../roles/manager.js';
import type { ModuleAffinityService } from '../tasks/affinity.js';
import { readAgentCheckpoint, writeAgentCheckpoint } from '../tasks/checkpoint.js';
import { ProgressTracker } from '../tasks/progress.js';
import type { TaskService } from '../tasks/service.js';

const hubBlockTaskInputSchema = z.object({
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
});

const hubCancelTaskInputSchema = z.object({
  agent_id: z.string().min(1),
  task_id: z.string().min(1),
});

export type StreamableHttpHub = {
  app: Express;
  transports: Record<string, StreamableHTTPServerTransport>;
};

function createMcpServerForHub(deps: {
  store: HubStore;
  registry: SessionRegistry;
  ctx: HubContext;
  publisher: BroadcastPublisher;
  eventSubscriber: EventSubscriber;
  mirrorRoot: string;
  taskService: TaskService;
  pathLeaseService: PathLeaseService;
  progressTracker: ProgressTracker;
  safetyLimiter: SafetyLimiter;
  auditJournal: AuditJournal;
  hubDb: HubDb;
  moduleAffinityService?: ModuleAffinityService;
  roleManager?: RoleManager;
  clkService?: ClkService;
}): McpServer {
  const {
    store,
    registry,
    ctx,
    publisher,
    eventSubscriber,
    mirrorRoot,
    taskService,
    pathLeaseService,
    progressTracker,
    safetyLimiter,
    auditJournal,
    hubDb,
    moduleAffinityService,
    roleManager,
    clkService,
  } = deps;
  const server = new McpServer({
    name: 'gsd-2-hub',
    version: '0.1.0',
  });

  server.registerTool(
    'hub_register',
    {
      description: 'Register or refresh this MCP session with a stable agent_id (reconnect updates mcp session binding).',
      inputSchema: {
        agent_id: z.string().min(1).max(256).describe('Stable agent identifier for routing and audit'),
        label: z.string().max(512).optional().describe('Optional human-readable label'),
        roles: z.array(z.string()).max(200).optional().describe('Optional capability roles'),
        skills: z.array(z.string()).max(500).optional().describe('Optional capability skills'),
        owned_modules: z.array(z.string().min(1)).max(50).optional().describe('Modules this agent is responsible for (memory affinity)'),
      },
    },
    async ({ agent_id, label, roles, skills, owned_modules }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const result = registry.register(sessionId, agent_id, label ?? null);
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'register_rejected', reason: result.reason }),
            },
          ],
          isError: true,
        };
      }
      ctx.logger.info({ agent_id, session_id: sessionId }, 'hub_register');
      safetyLimiter.ensureTracked(agent_id);
      if ((roles?.length ?? 0) > 0 || (skills?.length ?? 0) > 0) {
        registry.saveCapabilities(agent_id, roles ?? [], skills ?? []);
      }
      if (moduleAffinityService && owned_modules && owned_modules.length > 0) {
        moduleAffinityService.declareOwnership(agent_id, owned_modules);
      }
      auditJournal.append({
        agentId: agent_id,
        taskId: null,
        action: 'hub.register',
        details: {
          label: label ?? null,
          roles: roles?.length ?? 0,
          skills: skills?.length ?? 0,
          owned_modules: owned_modules ?? [],
        },
        correlationId: null,
      });

      // Include role assignment info if the agent already has a role
      const assignedRole = roleManager?.getRole(agent_id) ?? null;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              agent_id,
              session_id: sessionId,
              assigned_role: assignedRole ? { role: assignedRole.role, status: assignedRole.status } : null,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_status',
    {
      description: 'Return hub health, session stats, and pending durable messages for the calling agent.',
      inputSchema: {
        include_payloads: z.boolean().optional().describe('Include full pending message payloads (default true)'),
      },
    },
    async ({ include_payloads }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered', hint: 'call hub_register first' }) }],
          isError: true,
        };
      }
      const pending = store.listPendingMessages(row.agentId);
      const show = include_payloads !== false;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              hub: {
                started_at: ctx.hubStartedAt.toISOString(),
                registered_sessions: store.countSessions(),
              },
              session: {
                agent_id: row.agentId,
                session_id: sessionId,
                label: row.label,
              },
              pending_messages: pending.map((m) =>
                show
                  ? { id: m.id, created_at: m.createdAt.toISOString(), payload: m.payload }
                  : { id: m.id, created_at: m.createdAt.toISOString() },
              ),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_ping',
    {
      description: 'Heartbeat and optional ack of consumed durable message ids.',
      inputSchema: {
        ack_message_ids: z.array(z.string()).max(500).optional().describe('Mark these message ids as consumed for this agent'),
      },
    },
    async ({ ack_message_ids }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      let touched = 0;
      if (ack_message_ids?.length) {
        touched = store.consumeMessages(row.agentId, ack_message_ids);
      }
      const ping = store.recordPing(sessionId);
      if (!ping.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ping_failed' }) }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              agent_id: row.agentId,
              session_id: sessionId,
              server_time: new Date().toISOString(),
              acked: touched,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_subscribe',
    {
      description: 'Restrict durable broadcast / SSE delivery to topic filters for this agent (empty = all topics).',
      inputSchema: hubSubscribeInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubSubscribeInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      eventSubscriber.setSubscription(parsed.data.agent_id, parsed.data.topics);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              subscription: { agent_id: parsed.data.agent_id, topics: parsed.data.topics },
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_publish',
    {
      description: 'Publish a durable hub event (persisted + SSE fan-out + poll cursor).',
      inputSchema: hubPublishInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubPublishInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      const out = publisher.publish({
        sourceAgentId: parsed.data.agent_id,
        topic: parsed.data.topic,
        payload: parsed.data.payload,
        idempotencyKey: parsed.data.idempotency_key,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              event: {
                ...out.event,
                timestamp: out.event.timestamp.toISOString(),
              },
              deduplicated: out.deduplicated,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_poll_events',
    {
      description: 'Fetch durable broadcast events after cursor / event id (poll fallback when SSE is unavailable).',
      inputSchema: hubPollEventsInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubPollEventsInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      const limit = Math.min(parsed.data.limit ?? 100, 500);
      let exclusiveSeq = store.getEventCursor(parsed.data.agent_id);
      if (parsed.data.after_event_id) {
        const seq = store.getBroadcastEventSequenceById(parsed.data.after_event_id);
        if (seq !== undefined) {
          exclusiveSeq = Math.max(exclusiveSeq, seq);
        }
      }
      const batch = store.listBroadcastEventsAfterSequence(exclusiveSeq, limit);
      const mapped = batch.map((r) => ({
        id: r.id,
        agent_id: r.sourceAgentId,
        topic: r.topic,
        payload: r.payload,
        timestamp: r.createdAt.toISOString(),
      }));
      let cursor: string | undefined;
      if (batch.length > 0) {
        cursor = batch[batch.length - 1].id;
        store.upsertEventCursor(parsed.data.agent_id, batch[batch.length - 1].sequenceNumber);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              events: mapped,
              cursor,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_state_read',
    {
      description: 'Read a versioned planning document from hub durable state.',
      inputSchema: hubStateReadInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubStateReadInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      const doc = store.getPlanningDocument(parsed.data.path);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              document: doc
                ? {
                    ...doc,
                    updated_at: doc.updated_at.toISOString(),
                  }
                : null,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_state_write',
    {
      description: 'Optimistic concurrency write for versioned planning documents (mirrored to workspace when under mirrorRoot).',
      inputSchema: hubStateWriteInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubStateWriteInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.updated_by !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'updated_by_mismatch' }) }],
          isError: true,
        };
      }
      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const cached = store.getIdempotencyResult(parsed.data.idempotency_key);
        if (cached && typeof cached === 'object' && cached !== null && 'result' in cached) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: true, result: (cached as { result: unknown }).result }),
              },
            ],
          };
        }
      }
      const result = store.writePlanningDocument({
        path: parsed.data.path,
        content: parsed.data.content,
        expectedVersion: parsed.data.expected_version,
        updatedBy: parsed.data.updated_by,
        mirrorRoot,
      });
      if (parsed.data.idempotency_key && result.status === 'success') {
        store.setIdempotencyResult(parsed.data.idempotency_key, { result }, IDEMP_TTL_MS);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, result }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_create_task',
    {
      description: 'Create a schedulable task with optional dependencies and parent linkage.',
      inputSchema: hubCreateTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubCreateTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.creator_agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'creator_agent_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const out = taskService.createTask(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, task: out.task }) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'create_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_claim_task',
    {
      description: 'Claim the next ready task (dependency-resolved) with a time-bounded lease.',
      inputSchema: hubClaimTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubClaimTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const out = taskService.claimTask(parsed.data);
        const body: Record<string, unknown> = { ok: true, task: out.task };
        if (out.scheduling_hint) {
          body.scheduling_hint = out.scheduling_hint;
        }
        return { content: [{ type: 'text', text: JSON.stringify(body) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'claim_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_heartbeat_task',
    {
      description: 'Extend the lease for a task claimed by this agent.',
      inputSchema: hubHeartbeatTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubHeartbeatTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const out = taskService.heartbeat(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, task: out.task }) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'heartbeat_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_complete_task',
    {
      description: 'Mark a claimed task done and potentially auto-complete parents when all children are done.',
      inputSchema: hubCompleteTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubCompleteTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const out = taskService.completeTask(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, task: out.task }) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'complete_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_block_task',
    {
      description: 'Mark a task blocked and release any lease.',
      inputSchema: hubBlockTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubBlockTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const task = taskService.blockTask(parsed.data.agent_id, parsed.data.task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, task }) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'block_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_cancel_task',
    {
      description: 'Cancel a task and release any lease.',
      inputSchema: hubCancelTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubCancelTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const task = taskService.cancelTask(parsed.data.agent_id, parsed.data.task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, task }) }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'cancel_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_list_tasks',
    {
      description: 'List tasks with optional filters (including ready_only for dependency-resolved open work).',
      inputSchema: hubListTasksInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubListTasksInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      const out = taskService.listTasks(parsed.data);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tasks: out.tasks }) }] };
    },
  );

  server.registerTool(
    'hub_split_task',
    {
      description: 'Split a parent task into child tasks tracked under the same parent_task_id.',
      inputSchema: hubSplitTaskInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubSplitTaskInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      try {
        const out = taskService.splitTask(parsed.data);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, parent: out.parent, children: out.children }) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'split_failed',
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'hub_acquire_lease',
    {
      description: 'Acquire an exclusive path lease (writer lock) with TTL.',
      inputSchema: hubAcquireLeaseInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubAcquireLeaseInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const hit = store.getIdempotencyResult(parsed.data.idempotency_key);
        const revived = reviveAcquireLease(hit);
        if (revived) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, ...serializeAcquireLease(revived) }) }],
          };
        }
      }

      const cfg = loadConfigFromDisk(mirrorRoot);
      const ttl = parsed.data.ttl_ms ?? cfg.default_lease_ttl_ms ?? 600_000;
      const out = pathLeaseService.acquire({
        agentId: parsed.data.agent_id,
        path: parsed.data.path,
        ttlMs: ttl,
      });

      if (parsed.data.idempotency_key) {
        store.setIdempotencyResult(parsed.data.idempotency_key, serializeAcquireLease(out), IDEMP_TTL_MS);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...serializeAcquireLease(out) }) }] };
    },
  );

  server.registerTool(
    'hub_release_lease',
    {
      description: 'Release a path lease by lease_id or path (must match agent_id).',
      inputSchema: hubReleaseLeaseInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubReleaseLeaseInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const hit = store.getIdempotencyResult(parsed.data.idempotency_key);
        if (typeof hit === 'boolean') {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, released: hit }) }] };
        }
      }

      const released = pathLeaseService.release({
        agentId: parsed.data.agent_id,
        leaseId: parsed.data.lease_id,
        path: parsed.data.path,
      });

      if (parsed.data.idempotency_key) {
        store.setIdempotencyResult(parsed.data.idempotency_key, released, IDEMP_TTL_MS);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, released }) }] };
    },
  );

  server.registerTool(
    'hub_check_lease',
    {
      description: 'Return the active exclusive lease for a path, if any.',
      inputSchema: hubCheckLeaseInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubCheckLeaseInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      const lease = pathLeaseService.check(parsed.data.path);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              lease: lease
                ? {
                    ...lease,
                    expires_at: lease.expires_at.toISOString(),
                    created_at: lease.created_at.toISOString(),
                  }
                : null,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_get_config',
    {
      description: 'Load persisted hub configuration (config.json) for this workspace root.',
      inputSchema: hubGetConfigInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubGetConfigInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      void parsed;
      const config = loadConfigFromDisk(mirrorRoot);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, config }) }] };
    },
  );

  server.registerTool(
    'hub_update_config',
    {
      description: 'Optimistically update config.json with versioned concurrency control.',
      inputSchema: hubUpdateConfigInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubUpdateConfigInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const hit = store.getIdempotencyResult(parsed.data.idempotency_key);
        if (hit && typeof hit === 'object' && hit !== null && 'status' in hit) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...(hit as Record<string, unknown>) }) }] };
        }
      }

      const out = updateConfigOnDisk(mirrorRoot, parsed.data);
      if (parsed.data.idempotency_key && out.status === 'success') {
        store.setIdempotencyResult(parsed.data.idempotency_key, out, IDEMP_TTL_MS);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...out }) }] };
    },
  );

  server.registerTool(
    'hub_checkpoint',
    {
      description: 'Persist a resumable checkpoint under .planning/hub/checkpoints for this agent/task.',
      inputSchema: hubCheckpointInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubCheckpointInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const hit = store.getIdempotencyResult(parsed.data.idempotency_key);
        if (hit && typeof hit === 'object' && hit !== null && 'checkpoint' in hit) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, checkpoint: (hit as { checkpoint: unknown }).checkpoint }) }] };
        }
      }

      const checkpoint = {
        agent_id: parsed.data.agent_id,
        task_id: parsed.data.task_id,
        progress_summary: parsed.data.progress_summary,
        context_snapshot: parsed.data.context_snapshot,
        timestamp: new Date(),
      };
      writeAgentCheckpoint(mirrorRoot, checkpoint);
      if (parsed.data.idempotency_key) {
        store.setIdempotencyResult(
          parsed.data.idempotency_key,
          {
            checkpoint: {
              ...checkpoint,
              timestamp: checkpoint.timestamp.toISOString(),
            },
          },
          IDEMP_TTL_MS,
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              checkpoint: { ...checkpoint, timestamp: checkpoint.timestamp.toISOString() },
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_handoff',
    {
      description: 'Build a handoff package from the latest checkpoint plus task metadata.',
      inputSchema: hubHandoffInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubHandoffInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const cp = readAgentCheckpoint(mirrorRoot, parsed.data.agent_id, parsed.data.task_id);
      if (!cp) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'checkpoint_missing' }) }],
          isError: true,
        };
      }

      const task = taskService.getTask(parsed.data.task_id);
      const remaining = task ? [`continue task ${task.id} (${task.workflow_stage})`] : [`resume task ${parsed.data.task_id}`];

      const pkg = {
        task_id: parsed.data.task_id,
        checkpoint: {
          ...cp,
          timestamp: cp.timestamp.toISOString(),
        },
        remaining_steps: remaining,
        artifacts: [] as string[],
      };
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, package: pkg }) }] };
    },
  );

  server.registerTool(
    'hub_request_help',
    {
      description: 'Broadcast a help request to other agents (durable event + SSE).',
      inputSchema: hubRequestHelpInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubRequestHelpInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }

      const out = publisher.publish({
        sourceAgentId: parsed.data.agent_id,
        topic: `help.${parsed.data.topic}`,
        payload: {
          summary: parsed.data.summary,
          task_id: parsed.data.task_id,
          details: parsed.data.payload ?? null,
          correlation_id: parsed.data.correlation_id ?? null,
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              broadcast: {
                ...out.event,
                timestamp: out.event.timestamp.toISOString(),
              },
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_report_progress',
    {
      description: 'Record lightweight autonomy loop progress for this agent/task.',
      inputSchema: hubReportProgressInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubReportProgressInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      const out = progressTracker.report(parsed.data);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...out }) }] };
    },
  );

  server.registerTool(
    'hub_set_limits',
    {
      description: 'Configure per-agent safety caps for tool calls, tokens, and wall time.',
      inputSchema: hubSetLimitsInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubSetLimitsInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      if (parsed.data.agent_id !== row.agentId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'agent_id_mismatch' }) }],
          isError: true,
        };
      }
      const IDEMP_TTL_MS = 86_400_000;
      if (parsed.data.idempotency_key) {
        const hit = store.getIdempotencyResult(parsed.data.idempotency_key);
        if (hit && typeof hit === 'object' && hit !== null && 'status' in hit) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...(hit as Record<string, unknown>) }) }] };
        }
      }
      const res = safetyLimiter.setPersisted(parsed.data.agent_id, parsed.data.limits, parsed.data.expected_version);
      const body =
        res.status === 'success'
          ? { status: 'success' as const, limits: res.limits, config_version: res.version }
          : { status: 'conflict' as const, limits: res.limits, config_version: res.version };
      if (parsed.data.idempotency_key && res.status === 'success') {
        store.setIdempotencyResult(parsed.data.idempotency_key, body, IDEMP_TTL_MS);
      }
      auditJournal.append({
        agentId: parsed.data.agent_id,
        taskId: null,
        action: 'hub.set_limits',
        details: body,
        correlationId: null,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...body }) }] };
    },
  );

  server.registerTool(
    'hub_token_ranking',
    {
      description:
        'Return all tracked agents ranked by token usage (least-used first). ' +
        'Useful for observing the token-aware task scheduler.',
      inputSchema: {},
    },
    async (_raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered', hint: 'call hub_register first' }) }],
          isError: true,
        };
      }
      const budgets = safetyLimiter.allBudgets();
      const ranking = budgets.map((b, idx) => ({
        rank: idx + 1,
        agent_id: b.agentId,
        tokens_used: b.usage.tokens,
        tokens_remaining: Number.isFinite(b.remainingTokens) ? b.remainingTokens : null,
        tool_calls: b.usage.calls,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ranking }) }] };
    },
  );

  server.registerTool(
    'hub_module_affinity',
    {
      description:
        'Query module ownership: who owns a module, or what modules an agent owns. ' +
        'Provide agent_id to see their modules, or module to see its owners.',
      inputSchema: {
        agent_id: z.string().min(1).optional().describe('Query modules owned by this agent'),
        module: z.string().min(1).optional().describe('Query owners of this module'),
      },
    },
    async ({ agent_id: queryAgentId, module: queryModule }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      }
      const row = store.getSessionByMcpId(sessionId);
      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered', hint: 'call hub_register first' }) }],
          isError: true,
        };
      }
      if (!moduleAffinityService) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'affinity_service_unavailable' }) }], isError: true };
      }
      const result: Record<string, unknown> = { ok: true };
      if (queryAgentId) {
        result.agent_modules = moduleAffinityService.getAgentModules(queryAgentId);
      }
      if (queryModule) {
        result.module_owners = moduleAffinityService.getModuleOwners(queryModule);
      }
      if (!queryAgentId && !queryModule) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'provide agent_id or module' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  // --- Role management tools ---

  server.registerTool(
    'hub_assign_role',
    {
      description: 'Assign a system role to an agent (proxy/controller/supervisor/clk/worker).',
      inputSchema: {
        agent_id: z.string().min(1).describe('Agent to assign the role to'),
        role: z.enum(['proxy', 'controller', 'supervisor', 'clk', 'worker']).describe('Role to assign'),
        tmux_session: z.string().optional().describe('Tmux session name'),
      },
    },
    async ({ agent_id: targetAgentId, role, tmux_session }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      const assignment = roleManager.assignRole(targetAgentId, role, tmux_session ?? null);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, assignment }) }] };
    },
  );

  server.registerTool(
    'hub_get_roles',
    {
      description: 'List all active role assignments, or query a specific role/agent.',
      inputSchema: {
        role: z.enum(['proxy', 'controller', 'supervisor', 'clk', 'worker']).optional(),
        agent_id: z.string().min(1).optional(),
      },
    },
    async ({ role, agent_id: queryAgentId }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      if (queryAgentId) {
        const r = roleManager.getRole(queryAgentId);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, role: r }) }] };
      }
      if (role) {
        const roles = roleManager.getAllByRole(role);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, roles }) }] };
      }
      const all = roleManager.getAllActive();
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, roles: all, reserve_count: roleManager.reserveCount() }) }] };
    },
  );

  server.registerTool(
    'hub_heartbeat_role',
    {
      description: 'Send a liveness heartbeat for your assigned role. Call on every tick.',
      inputSchema: {
        agent_id: z.string().min(1),
      },
    },
    async ({ agent_id: beatAgentId }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      roleManager.recordHeartbeat(beatAgentId);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    'hub_clk_status',
    {
      description: 'Get CLK tick state: current tick number, interval, and last tick time.',
      inputSchema: {},
    },
    async (_raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!clkService) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'clk_unavailable' }) }], isError: true };

      const state = clkService.getState();
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...state }) }] };
    },
  );

  server.registerTool(
    'hub_save_state',
    {
      description: 'Save a state snapshot for your role (used for succession handoff).',
      inputSchema: {
        agent_id: z.string().min(1),
        snapshot: z.any().describe('Arbitrary JSON state to preserve for successor'),
      },
    },
    async ({ agent_id: stateAgentId, snapshot }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      roleManager.saveStateSnapshot(stateAgentId, snapshot);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    'hub_succeed_role',
    {
      description: 'Trigger succession for a dead agent: mark it dead and assign a reserve agent to take over its role.',
      inputSchema: {
        dead_agent_id: z.string().min(1).describe('The agent that has died and needs replacement'),
      },
    },
    async ({ dead_agent_id }, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      const newAssignment = roleManager.succeedRole(dead_agent_id);
      if (!newAssignment) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'no_reserves_available' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, new_assignment: newAssignment }) }] };
    },
  );

  server.registerTool(
    'hub_reserve_count',
    {
      description: 'Get the number of standby agents in the reserve pool.',
      inputSchema: {},
    },
    async (_raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }], isError: true };
      const row = store.getSessionByMcpId(sessionId);
      if (!row) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }], isError: true };
      if (!roleManager) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'role_manager_unavailable' }) }], isError: true };

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count: roleManager.reserveCount() }) }] };
    },
  );

  server.registerTool(
    'hub_get_audit_log',
    {
      description: 'Read append-only audit entries (operator diagnostics).',
      inputSchema: hubGetAuditLogInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubGetAuditLogInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      const lim = Math.min(parsed.data.limit ?? 100, 1000);
      const { entries, cursor } = auditJournal.list({
        afterId: parsed.data.after_id,
        limit: lim,
        agentId: parsed.data.agent_id,
        taskId: parsed.data.task_id,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              entries: entries.map((e) => ({
                ...e,
                timestamp: e.timestamp.toISOString(),
              })),
              cursor,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hub_get_health',
    {
      description: 'Hub liveness snapshot (stale sessions, backlog, claimed tasks).',
      inputSchema: hubGetHealthInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubGetHealthInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      void parsed;
      const health = buildHealthStatus(hubDb);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, health }) }] };
    },
  );

  server.registerTool(
    'hub_get_progress',
    {
      description: 'Roll up task completion counts by workflow stage.',
      inputSchema: hubGetProgressInputSchema.shape,
    },
    async (raw, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'missing_session_id' }) }],
          isError: true,
        };
      }
      if (!store.getSessionByMcpId(sessionId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_registered' }) }],
          isError: true,
        };
      }
      const parsed = hubGetProgressInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_input' }) }],
          isError: true,
        };
      }
      const by_phase = buildProgressByPhase(hubDb, parsed.data.workflow_stage);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, by_phase }) }] };
    },
  );

  return server;
}

function serializeAcquireLease(out: HubAcquireLeaseOutput): Record<string, unknown> {
  if (out.status === 'granted') {
    return {
      status: 'granted',
      lease: {
        ...out.lease,
        expires_at: out.lease.expires_at.toISOString(),
        created_at: out.lease.created_at.toISOString(),
      },
    };
  }
  return {
    status: 'conflict',
    holder: {
      ...out.holder,
      expires_at: out.holder.expires_at.toISOString(),
      created_at: out.holder.created_at.toISOString(),
    },
  };
}

function reviveAcquireLease(value: unknown): HubAcquireLeaseOutput | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.status === 'granted' && v.lease && typeof v.lease === 'object') {
    const l = v.lease as Record<string, unknown>;
    if (typeof l.expires_at !== 'string' || typeof l.created_at !== 'string') return null;
    return {
      status: 'granted',
      lease: {
        path: l.path as string,
        agent_id: l.agent_id as string,
        lease_id: l.lease_id as string,
        expires_at: new Date(l.expires_at),
        created_at: new Date(l.created_at),
      },
    };
  }
  if (v.status === 'conflict' && v.holder && typeof v.holder === 'object') {
    const h = v.holder as Record<string, unknown>;
    if (typeof h.expires_at !== 'string' || typeof h.created_at !== 'string') return null;
    return {
      status: 'conflict',
      holder: {
        path: h.path as string,
        agent_id: h.agent_id as string,
        lease_id: h.lease_id as string,
        expires_at: new Date(h.expires_at),
        created_at: new Date(h.created_at),
      },
    };
  }
  return null;
}

/** Wire Streamable HTTP MCP routes onto an Express app. */
export function mountStreamableHttpHub(
  app: Express,
  deps: {
    store: HubStore;
    registry: SessionRegistry;
    ctx: HubContext;
    sseHub: SseHub;
    publisher: BroadcastPublisher;
    eventSubscriber: EventSubscriber;
    mirrorRoot: string;
    taskService: TaskService;
    pathLeaseService: PathLeaseService;
    progressTracker: ProgressTracker;
    safetyLimiter: SafetyLimiter;
    auditJournal: AuditJournal;
    hubDb: HubDb;
    moduleAffinityService?: ModuleAffinityService;
    roleManager?: RoleManager;
    clkService?: ClkService;
  },
): StreamableHttpHub {
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const { ctx, registry, sseHub } = deps;

  app.get('/hub/events/stream', (req, res) => {
    const sid = typeof req.query.mcp_session_id === 'string' ? req.query.mcp_session_id : '';
    if (!sid) {
      res.status(400).send('missing mcp_session_id');
      return;
    }
    const sessionRow = registry.getByMcpSession(sid);
    if (!sessionRow) {
      res.status(401).send('unknown session');
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    const detach = sseHub.addClient(sessionRow.agentId, res);
    req.on('close', () => {
      detach();
    });
  });

  const mcpPostHandler: RequestHandler = async (req, res) => {
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && req.body && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };
        const mcp = createMcpServerForHub(deps);
        await mcp.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32_000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
    } catch (err) {
      ctx.logger.error({ err }, 'mcp POST error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32_603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  const mcpGetHandler: RequestHandler = async (req, res) => {
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  const mcpDeleteHandler: RequestHandler = async (req, res) => {
    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  app.post('/mcp', mcpPostHandler);
  app.get('/mcp', mcpGetHandler);
  app.delete('/mcp', mcpDeleteHandler);

  return { app, transports };
}

/** Express app with DNS rebinding middleware defaults from MCP SDK. */
export function createHubExpress(): Express {
  const app = createMcpExpressApp();
  // MCP SDK 默认 express.json() 限制 100KB，不够用于大任务描述和大 payload
  // 在路由挂载前插入更高 limit 的 json parser，优先匹配
  app.use(express.json({ limit: '10mb' }));
  return app;
}
