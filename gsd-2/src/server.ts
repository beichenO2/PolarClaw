import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pino from 'pino';
import { BroadcastPublisher } from './broadcast/publisher.js';
import { SseHub } from './broadcast/sse-hub.js';
import { EventSubscriber } from './broadcast/subscriber.js';
import { watchConfig } from './config/loader.js';
import { createHubDatabase } from './persistence/db.js';
import { PathLeaseService } from './persistence/path-leases.js';
import { ClkService } from './roles/clk.js';
import { RoleManager } from './roles/manager.js';
import { AuditJournal } from './safety/audit.js';
import { SafetyLimiter } from './safety/limiter.js';
import { HubStore } from './persistence/store.js';
import { SessionRegistry } from './session/registry.js';
import { ModuleAffinityService } from './tasks/affinity.js';
import { ProgressTracker } from './tasks/progress.js';
import { TaskService } from './tasks/service.js';
import { createHubExpress, mountStreamableHttpHub } from './transport/http.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }, pino.destination(2));
const hubStartedAt = new Date();

const dbPath = process.env.GSD_HUB_DB ?? join(process.cwd(), '.planning/hub/hub.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const { sqlite, db } = createHubDatabase(dbPath);
const store = new HubStore(db);
const registry = new SessionRegistry(store, logger);
const sseHub = new SseHub();
const eventSubscriber = new EventSubscriber();
const publisher = new BroadcastPublisher(store, sseHub, eventSubscriber);
const taskService = new TaskService(db, sqlite, store);
const pathLeaseService = new PathLeaseService(db);
const progressTracker = new ProgressTracker();
const safetyLimiter = new SafetyLimiter(db);
const moduleAffinityService = new ModuleAffinityService(db, safetyLimiter);
const roleManager = new RoleManager(db);
const clkService = new ClkService(db, publisher, roleManager, logger);
taskService.setLimiter(safetyLimiter);
taskService.setAffinityService(moduleAffinityService);
const auditJournal = new AuditJournal(db);

const stopConfigWatch = watchConfig(process.cwd(), (cfg) => {
  logger.info({ version: cfg.version }, 'config.json reloaded');
});

const app = createHubExpress();
mountStreamableHttpHub(app, {
  store,
  registry,
  ctx: { logger, hubStartedAt },
  sseHub,
  publisher,
  eventSubscriber,
  mirrorRoot: process.cwd(),
  taskService,
  pathLeaseService,
  progressTracker,
  safetyLimiter,
  auditJournal,
  hubDb: db,
  moduleAffinityService,
  roleManager,
  clkService,
});

const port = Number(process.env.GSD_HUB_PORT ?? process.env.PORT ?? 8765);
const host = process.env.GSD_HUB_HOST ?? '127.0.0.1';

const httpServer = app.listen(port, host, () => {
  logger.info({ port, host, dbPath }, 'gsd-2 MCP hub (Streamable HTTP) listening');
  // Start CLK only if enabled (default: enabled)
  if (process.env.GSD_CLK_DISABLED !== '1') {
    clkService.start();
    logger.info('CLK tick service started');
  }
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down hub');
  clkService.stop();
  stopConfigWatch();
  httpServer.close(() => {
    sqlite.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
