/**
 * MyClaw Web Server — serves the Web SPA and provides REST APIs
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
  const distDir = config.webDistDir ?? join(__dirname, '..', '..', '..', 'web', 'dist');
  if (existsSync(distDir)) {
    app.use('/mc', express.static(distDir));
    app.get(/^\/mc\/.*/, (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  // ── Static: serve uploaded files and slide images ──────
  app.use('/files', express.static(uploadsDir));
  app.use('/slides', express.static(slidesDir));

  // ── Hub API proxy (for YOLO alignment docs) ───────────
  const hubPort = process.env.PC_HUB_PORT || '10015';
  app.use('/hub-api', async (req, res) => {
    try {
      const url = `http://127.0.0.1:${hubPort}/api/ui${req.url}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (req.headers['x-agent-id']) headers['X-Agent-Id'] = String(req.headers['x-agent-id']);
      const opts: RequestInit = { method: req.method, headers };
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
        opts.body = JSON.stringify(req.body);
      }
      const upstream = await fetch(url, opts);
      res.status(upstream.status);
      const text = await upstream.text();
      try { res.json(JSON.parse(text)); } catch { res.send(text); }
    } catch (e: unknown) {
      res.status(502).json({ error: 'hub_unreachable', message: String(e) });
    }
  });

  // ── API: status ────────────────────────────────────────
  app.get('/api/status', (_req, res) => {
    res.json({
      name: 'MyClaw',
      version: '0.1.0',
      channels: [],
      uptime: process.uptime(),
      memory: { totalEntries: 0, dbSizeBytes: 0 },
      skills: { count: 0, names: [] },
      yolo: { activeSessions: 0 },
    });
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

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    start() {
      return new Promise<void>((resolve) => {
        server = app.listen(config.port, '127.0.0.1', () => {
          console.error(`[MyClaw Web] Listening on http://127.0.0.1:${config.port}/mc/`);
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
