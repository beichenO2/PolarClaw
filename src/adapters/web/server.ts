/**
 * PolarClaw Web Server — serves the Web SPA and provides REST APIs
 * for review items (PDF annotations, PPT diffs) and agent status.
 */

import express from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, copyFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface WebServerConfig {
  port: number;
  dataDir: string;
  webDistDir?: string;
  getStatus?: () => AgentStatusData;
  pilotEngine?: import('../pilot/engine.js').PilotEngine;
  pilotStore?: import('../pilot/store.js').PilotStore;
  llm?: import('../../ports/llm.js').ILLMRouter;
  memoryStore?: import('../../ports/memory.js').IMemoryStore;
  /** Full agent handler (ReAct loop + tools + memory + privacy) */
  agentHandler?: (msg: { channel: string; userId: string; text: string }) => Promise<string>;
  yoloEngine?: {
    run(config: { sessionId?: string; goal: string; maxSteps: number; maxTotalTokens: number; maxWallTimeMs: number; maxRetries: number },
        context: { channel: string; userId: string }): Promise<YoloSessionData>;
    cancel(sessionId: string): void;
    getSession(sessionId: string): YoloSessionData | null;
  };
  /** PolarClaw SDK instance (provides /api/sdk/* routes) */
  sdk?: import('../../sdk/index.js').PolarClawSDK;
}

export interface AgentStatusData {
  name: string;
  version: string;
  channels: { name: string; connected: boolean }[];
  uptime: number;
  memory: { totalEntries: number; dbSizeBytes: number };
  skills: { count: number; names: string[] };
  yolo: { activeSessions: number };
}

export interface YoloSessionData {
  sessionId: string;
  status: string;
  stepsCompleted: number;
  totalTokensUsed: number;
  elapsedMs: number;
  steps: { step: number; text: string; tokensUsed: number; goalReached: boolean; error?: string; durationMs: number }[];
  stopReason?: string;
}

interface ReviewRecord {
  id: string;
  type: 'pdf' | 'ppt';
  filename: string;
  status: 'pending' | 'reviewed' | 'approved';
  agent_id: string;
  annotations: AnnotationRecord[];
  slides?: { index: number; image_url: string }[];
  agent_diffs?: PptDiffRecord[];
  user_diffs?: PptDiffRecord[];
  created_at: string;
  updated_at: string;
}

interface AnnotationRecord {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  comment: string;
  author: string;
  created_at: string;
}

interface PptDiffRecord {
  slide_index: number;
  change_type: 'add' | 'remove' | 'modify';
  target: string;
  before: string;
  after: string;
}

function findLibreOffice(): string | null {
  const candidates = [
    '/usr/bin/libreoffice',
    '/usr/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const which = execSync('which soffice 2>/dev/null || which libreoffice 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which) return which;
  } catch { /* not found */ }
  return null;
}

function convertPptxToImages(pptxPath: string, outDir: string): string[] {
  const soffice = findLibreOffice();
  if (!soffice) {
    console.error('[WebServer] LibreOffice not found — PPT slide rendering unavailable');
    return [];
  }

  mkdirSync(outDir, { recursive: true });
  try {
    execSync(`"${soffice}" --headless --convert-to png --outdir "${outDir}" "${pptxPath}"`, {
      timeout: 60000,
      encoding: 'utf8',
    });
  } catch (err) {
    console.error('[WebServer] LibreOffice conversion failed:', err);
    return [];
  }

  return readdirSync(outDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => join(outDir, f));
}

export function createWebServer(config: WebServerConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const reviewDir = join(config.dataDir, 'reviews');
  const uploadsDir = join(config.dataDir, 'uploads');
  const slidesDir = join(config.dataDir, 'slides');
  mkdirSync(reviewDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(slidesDir, { recursive: true });

  const upload = multer({ dest: uploadsDir });

  function loadReviews(): ReviewRecord[] {
    const indexPath = join(reviewDir, 'index.json');
    if (!existsSync(indexPath)) return [];
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch { return []; }
  }

  function saveReviews(records: ReviewRecord[]) {
    writeFileSync(join(reviewDir, 'index.json'), JSON.stringify(records, null, 2));
  }

  // ── Static: serve Web SPA ──────────────────────────────
  const distDir = config.webDistDir ?? '';
  if (existsSync(distDir)) {
    app.use('/mc', express.static(distDir));
    app.get(/^\/mc\/.*/, (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  // ── Static: serve uploaded files and slide images ──────
  app.use('/files', express.static(uploadsDir));
  app.use('/slides', express.static(slidesDir));

  // ── API: status ────────────────────────────────────────
  app.get('/api/status', (_req, res) => {
    if (config.getStatus) {
      res.json(config.getStatus());
    } else {
      res.json({
        name: 'PolarClaw',
        version: '0.1.0',
        channels: [],
        uptime: process.uptime(),
        memory: { totalEntries: 0, dbSizeBytes: 0 },
        skills: { count: 0, names: [] },
        yolo: { activeSessions: 0 },
      });
    }
  });

  // ── API: models (list configured models) ────────────
  app.get('/api/models', (_req, res) => {
    if (!config.llm) return res.json({ models: [] });
    const { model: _unused, intent: _i, ...resolveInfo } = config.llm.resolveModel([{ role: 'user', content: 'test' }]);
    const modelSet = new Set<string>();
    const intentModels: Record<string, string> = {};
    for (const intent of ['general', 'coding', 'research', 'vision'] as const) {
      const { model: m } = config.llm.resolveModel([{ role: 'user', content:
        intent === 'coding' ? '写代码' : intent === 'research' ? '研究论文' : intent === 'vision' ? '看图片' : '你好'
      }]);
      modelSet.add(m);
      intentModels[intent] = m;
    }
    res.json({ models: [...modelSet], intent_models: intentModels });
  });

  // ── API: agent chat (full ReAct loop with tools) ────────
  app.post('/api/agent/chat', async (req, res) => {
    if (!config.agentHandler) return res.status(503).json({ error: 'agent not available' });
    try {
      const { message, conversation_id } = req.body as {
        message?: string;
        conversation_id?: string;
      };
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message (string) required' });
      }
      const channel = conversation_id ? `hub:${conversation_id}` : 'hub:anonymous';
      const reply = await config.agentHandler({
        channel,
        userId: 'hub-user',
        text: message,
      });
      res.json({ content: reply, conversation_id: channel });
    } catch (err) {
      console.error('[PolarClaw] /api/agent/chat error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: chat (LLM proxy for external callers) ────────
  app.post('/api/chat', async (req, res) => {
    if (!config.llm) return res.status(503).json({ error: 'llm not configured' });
    try {
      const { messages, system, context_query, max_tokens, model: requestedModel } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        system?: string;
        context_query?: string;
        max_tokens?: number;
        model?: string;
      };
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages[] required' });
      }

      const chatMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];

      if (system) {
        chatMessages.push({ role: 'system', content: system });
      }

      if (context_query && config.memoryStore) {
        const memResults = config.memoryStore.search(context_query, { limit: 5 });
        if (memResults.entries.length > 0) {
          const memContext = memResults.entries.map(e => e.content).join('\n---\n');
          chatMessages.push({ role: 'system', content: `## 长期记忆上下文\n${memContext}` });
        }
      }

      for (const m of messages) {
        chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }

      const resolvedModel = requestedModel || config.llm.resolveModel(chatMessages).model;
      const result = await config.llm.chat(chatMessages, {
        model: requestedModel || undefined,
        temperature: 0.3,
        maxTokens: max_tokens ?? 4096,
      });
      res.json({
        content: result.content ?? '',
        usage: result.usage,
        model: resolvedModel,
      });
    } catch (err) {
      console.error('[PolarClaw] /api/chat error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: YOLO sessions ─────────────────────────────────
  const knownSessionIds: string[] = [];

  app.get('/api/yolo/sessions', (_req, res) => {
    if (!config.yoloEngine) return res.json([]);
    const sessions = knownSessionIds
      .map(id => config.yoloEngine!.getSession(id))
      .filter((s): s is YoloSessionData => s !== null);
    res.json(sessions);
  });

  app.get('/api/yolo/sessions/:id', (req, res) => {
    if (!config.yoloEngine) return res.status(404).json({ error: 'yolo engine not available' });
    const session = config.yoloEngine.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  app.post('/api/yolo/start', (req, res) => {
    if (!config.yoloEngine) return res.status(503).json({ error: 'yolo engine not available' });
    const { goal, max_steps } = req.body as { goal?: string; max_steps?: number };
    if (!goal?.trim()) return res.status(400).json({ error: 'goal is required' });

    const sessionId = `yolo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    knownSessionIds.push(sessionId);

    config.yoloEngine.run(
      { sessionId, goal: goal.trim(), maxSteps: max_steps ?? 10, maxTotalTokens: 200000, maxWallTimeMs: 600000, maxRetries: 2 },
      { channel: 'web', userId: 'admin' },
    ).catch(err => console.error('[WebServer] YOLO run error:', err));

    res.json({ ok: true, sessionId });
  });

  app.post('/api/yolo/cancel/:id', (req, res) => {
    if (!config.yoloEngine) return res.status(503).json({ error: 'yolo engine not available' });
    config.yoloEngine.cancel(req.params.id);
    res.json({ ok: true });
  });

  // ── API: review list ───────────────────────────────────
  app.get('/api/review', (_req, res) => {
    res.json(loadReviews());
  });

  // ── API: review get ────────────────────────────────────
  app.get('/api/review/:id', (req, res) => {
    const records = loadReviews();
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: 'not found' });
    res.json(record);
  });

  // ── API: review file download ──────────────────────────
  app.get('/api/review/:id/file', (req, res) => {
    const records = loadReviews();
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: 'not found' });
    const filePath = join(uploadsDir, record.id + extname(record.filename));
    if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    res.sendFile(filePath);
  });

  // ── API: upload review file ────────────────────────────
  app.post('/api/review/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });

    const ext = extname(req.file.originalname).toLowerCase();
    const type = ext === '.pdf' ? 'pdf' : 'ppt';
    const id = randomUUID();
    const agentId = (req.body as { agent_id?: string })?.agent_id ?? 'local';

    const destPath = join(uploadsDir, id + ext);
    try { renameSync(req.file.path, destPath); } catch { copyFileSync(req.file.path, destPath); unlinkSync(req.file.path); }

    let slides: ReviewRecord['slides'] = [];
    if (type === 'ppt') {
      const slideOutDir = join(slidesDir, id);
      const imagePaths = convertPptxToImages(destPath, slideOutDir);
      slides = imagePaths.map((p, i) => ({
        index: i,
        image_url: `/slides/${id}/${basename(p)}`,
      }));
    }

    const record: ReviewRecord = {
      id,
      type,
      filename: req.file.originalname,
      status: 'pending',
      agent_id: agentId,
      annotations: [],
      slides,
      agent_diffs: [],
      user_diffs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const records = loadReviews();
    records.push(record);
    saveReviews(records);

    res.json({ ok: true, id, slides: slides?.length ?? 0 });
  });

  // ── API: add annotation ────────────────────────────────
  app.post('/api/review/:id/annotate', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const body = req.body as Partial<AnnotationRecord>;
    const ann: AnnotationRecord = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      page: body.page ?? 1,
      x: body.x ?? 0,
      y: body.y ?? 0,
      width: body.width ?? 0,
      height: body.height ?? 0,
      comment: body.comment ?? '',
      author: body.author ?? 'user',
      created_at: new Date().toISOString(),
    };

    const rec = records[idx]!;
    rec.annotations.push(ann);
    rec.status = 'reviewed';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true, annotation: ann });
  });

  // ── API: submit PPT diffs ──────────────────────────────
  app.post('/api/review/:id/diff', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const { diffs } = req.body as { diffs: PptDiffRecord[] };
    const rec = records[idx]!;
    rec.user_diffs = diffs;
    rec.status = 'reviewed';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true });
  });

  // ── API: approve ───────────────────────────────────────
  app.post('/api/review/:id/approve', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const rec = records[idx]!;
    rec.status = 'approved';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true });
  });

  // ── API: agent can push review items programmatically ──
  app.post('/api/review', (req, res) => {
    const body = req.body as Partial<ReviewRecord>;
    const record: ReviewRecord = {
      id: body.id ?? randomUUID(),
      type: body.type ?? 'pdf',
      filename: body.filename ?? 'unknown',
      status: 'pending',
      agent_id: body.agent_id ?? 'agent',
      annotations: [],
      slides: body.slides ?? [],
      agent_diffs: body.agent_diffs ?? [],
      user_diffs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const records = loadReviews();
    records.push(record);
    saveReviews(records);

    res.json({ ok: true, id: record.id });
  });

  // ── API: delete review item ────────────────────────────
  app.delete('/api/review/:id', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const removed = records.splice(idx, 1)[0]!;
    saveReviews(records);

    const filePath = join(uploadsDir, removed.id + extname(removed.filename));
    try { unlinkSync(filePath); } catch { /* ok */ }

    res.json({ ok: true });
  });

  // ── API: Pilot projects ────────────────────────────────
  if (config.pilotStore && config.pilotEngine) {
    const pStore = config.pilotStore;
    const pEngine = config.pilotEngine;

    app.get('/api/pilot/projects', (_req, res) => {
      try { res.json({ items: pStore.list() }); }
      catch (err: any) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/pilot/projects/:id', (req, res) => {
      const p = pStore.get(req.params.id);
      if (!p) { res.status(404).json({ error: 'not_found' }); return; }
      res.json(p);
    });

    app.post('/api/pilot/projects', (req, res) => {
      try {
        const { name, description, input_spec, output_spec } = req.body;
        if (!name || !input_spec) { res.status(400).json({ error: 'name and input_spec required' }); return; }
        const p = pStore.create({ name, description, input_spec, output_spec });
        res.json(p);
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.post('/api/pilot/projects/:id/start', async (req, res) => {
      try {
        const result = await pEngine.start(req.params.id);
        const p = pStore.get(req.params.id);
        res.json({ ok: true, ...result, project: p });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.post('/api/pilot/projects/:id/cancel', (req, res) => {
      try {
        pEngine.cancel(req.params.id);
        res.json({ ok: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.post('/api/pilot/projects/:id/phases/:idx/status', (req, res) => {
      try {
        const result = pEngine.updatePhaseStatus(
          req.params.id,
          parseInt(req.params.idx, 10),
          req.body.status,
          req.body.agent_id,
          req.body.deliverables,
        );
        res.json(result);
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });
  }

  // ── SDK API routes (/api/sdk/*) ──────────────────────────
  if (config.sdk) {
    const sdk = config.sdk;

    app.get('/api/sdk/version', (_req, res) => {
      res.json({ version: sdk.version });
    });

    // Users
    app.get('/api/sdk/users/:id', (req, res) => {
      try {
        const result = sdk.users.resolve(req.params.id);
        res.json(result);
      } catch (err: any) {
        res.status(err.code === 'user_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/users', (_req, res) => {
      res.json({
        humans: sdk.users.listHumans(),
        projects: sdk.users.listProjects(),
      });
    });

    // Events
    app.post('/api/sdk/events', async (req, res) => {
      try {
        const result = await sdk.events.emit(req.body);
        res.status(result.accepted ? 201 : 200).json(result);
      } catch (err: any) {
        const status = err.code === 'invalid_event' || err.code === 'validation_error' ? 400 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/events', (req, res) => {
      const project = req.query.project as string | undefined;
      const since = req.query.since as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      res.json(sdk.events.queryLocal({ project, since, limit }));
    });

    // Lobsters
    app.get('/api/sdk/lobsters/:projectId/status', (req, res) => {
      try {
        res.json(sdk.lobsters.status(req.params.projectId));
      } catch (err: any) {
        res.status(err.code === 'project_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/lobsters', (_req, res) => {
      res.json(sdk.lobsters.statusAll());
    });

    // Targets
    app.get('/api/sdk/targets/:projectId', (req, res) => {
      res.json(sdk.targets.list(req.params.projectId));
    });

    app.get('/api/sdk/targets/:projectId/:targetId', (req, res) => {
      try {
        res.json(sdk.targets.get(req.params.projectId, req.params.targetId));
      } catch (err: any) {
        res.status(err.code === 'target_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId', (req, res) => {
      try {
        const target = sdk.targets.create(req.params.projectId, req.body);
        res.status(201).json(target);
      } catch (err: any) {
        const status = err.code === 'project_not_found' ? 404 : 400;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.put('/api/sdk/targets/:projectId/:targetId', (req, res) => {
      try {
        const target = sdk.targets.update(req.params.projectId, req.params.targetId, req.body);
        res.json(target);
      } catch (err: any) {
        res.status(err.code === 'target_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId/:targetId/arrow', (req, res) => {
      try {
        const target = sdk.targets.appendArrowLog(req.params.projectId, req.params.targetId, req.body);
        res.json(target);
      } catch (err: any) {
        res.status(err.code === 'target_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId/:targetId/test', async (req, res) => {
      try {
        const result = await sdk.targets.runTest(req.params.projectId, req.params.targetId);
        res.json(result);
      } catch (err: any) {
        res.status(err.code === 'target_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    // Approvals
    app.post('/api/sdk/approvals', (req, res) => {
      try {
        const approval = sdk.approvals.request(req.body);
        res.status(201).json(approval);
      } catch (err: any) {
        res.status(400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/approvals/pending', (_req, res) => {
      res.json(sdk.approvals.listPending());
    });

    app.get('/api/sdk/approvals/:id', (req, res) => {
      try {
        res.json(sdk.approvals.get(req.params.id));
      } catch (err: any) {
        res.status(404).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/approvals/:id/callback', (req, res) => {
      try {
        const resolved = sdk.approvals.callback(
          { approval_id: req.params.id, ...req.body },
          req.body.resolved_by ?? 'api',
        );
        res.json(resolved);
      } catch (err: any) {
        res.status(400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    /** @deprecated Alias for backward compatibility */
    app.use('/api/myclaw-sdk', (req, res, next) => {
      console.warn(`[deprecated] /api/myclaw-sdk${req.path} — use /api/sdk${req.path}`);
      res.redirect(308, `/api/sdk${req.path}`);
    });
  }

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    start() {
      return new Promise<void>((resolve) => {
        server = app.listen(config.port, '127.0.0.1', () => {
          console.error(`[PolarClaw Web] Listening on http://127.0.0.1:${config.port}/mc/`);
          resolve();
        });
      });
    },
    stop() {
      server?.close();
    },
    app,
  };
}
