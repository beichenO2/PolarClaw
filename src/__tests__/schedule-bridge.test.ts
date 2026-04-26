import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduleBridge, type IScheduleBridgeConfig } from '../adapters/proactive/schedule-bridge.js';
import type { IProactiveEngine, IProactiveTrigger, IProactiveMessage, IScheduleRule } from '../ports/proactive.js';
import { createServer, type Server } from 'node:http';

function makeCareEngine() {
  const triggers: IProactiveTrigger[] = [];
  const engine: IProactiveEngine = {
    start: vi.fn(),
    stop: vi.fn(),
    trigger: vi.fn().mockImplementation(async (t: IProactiveTrigger) => {
      triggers.push(t);
      return { userId: t.userId, prompt: 'care', priority: 'normal' as const, tag: 'test' };
    }),
    addRule: vi.fn(),
    removeRule: vi.fn().mockReturnValue(true),
    listRules: vi.fn().mockReturnValue([]),
  };
  return { engine, triggers };
}

async function createMockClockServer(scheduleData: unknown): Promise<{
  server: Server;
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/schedule/today')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(scheduleData));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(addr && typeof addr !== 'string' ? addr.port : 0);
    });
  });

  return {
    server,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('createScheduleBridge', () => {
  let clockServer: ReturnType<typeof createMockClockServer>;

  afterEach(async () => {
    if (clockServer) await clockServer.close();
  });

  it('triggers pre-alert for upcoming schedule block', async () => {
    const future = new Date(Date.now() + 8 * 60_000);
    const futureEnd = new Date(Date.now() + 38 * 60_000);
    const startHhmm = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const endHhmm = `${String(futureEnd.getHours()).padStart(2, '0')}:${String(futureEnd.getMinutes()).padStart(2, '0')}`;

    clockServer = await createMockClockServer({
      rules: [{ name: '算法课', start_hhmm: startHhmm, end_hhmm: endHhmm }],
    });

    const { engine, triggers } = makeCareEngine();
    const bridge = createScheduleBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${clockServer.port}`,
        username: 'testuser',
        pollIntervalMs: 100,
        preAlertMs: 10 * 60_000,
      },
      engine,
    );

    bridge.start();
    await new Promise(r => setTimeout(r, 300));
    bridge.stop();

    expect(triggers.length).toBeGreaterThanOrEqual(1);
    const preAlert = triggers.find(t => t.reason === 'schedule-pre-alert');
    expect(preAlert).toBeDefined();
    expect(preAlert?.userId).toBe('testuser');
  });

  it('does not trigger pre-alert for distant schedule blocks', async () => {
    clockServer = await createMockClockServer({
      rules: [{ name: '晚间会议', start_hhmm: '23:59', end_hhmm: '23:59' }],
    });

    const { engine, triggers } = makeCareEngine();
    const bridge = createScheduleBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${clockServer.port}`,
        username: 'testuser',
        pollIntervalMs: 100,
        preAlertMs: 10 * 60_000,
      },
      engine,
    );

    bridge.start();
    await new Promise(r => setTimeout(r, 300));
    bridge.stop();

    const preAlerts = triggers.filter(t => t.reason === 'schedule-pre-alert');
    expect(preAlerts.length).toBe(0);
  });

  it('handles meal windows', async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    const startHhmm = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;

    clockServer = await createMockClockServer({
      meal_windows: [{ name: '午餐', start_hhmm: startHhmm, end_hhmm: startHhmm }],
    });

    const { engine, triggers } = makeCareEngine();
    const bridge = createScheduleBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${clockServer.port}`,
        username: 'testuser',
        pollIntervalMs: 100,
        preAlertMs: 10 * 60_000,
      },
      engine,
    );

    bridge.start();
    await new Promise(r => setTimeout(r, 300));
    bridge.stop();

    const preAlerts = triggers.filter(t => t.reason === 'schedule-pre-alert');
    expect(preAlerts.length).toBeGreaterThanOrEqual(1);
    const mealAlert = preAlerts.find(t => (t.context?.block as { type?: string })?.type === 'meal');
    expect(mealAlert).toBeDefined();
  });

  it('handles Clock server being down gracefully', async () => {
    const { engine, triggers } = makeCareEngine();
    const bridge = createScheduleBridge(
      {
        clockBaseUrl: 'http://127.0.0.1:1',
        username: 'testuser',
        pollIntervalMs: 100,
      },
      engine,
    );

    bridge.start();
    await new Promise(r => setTimeout(r, 300));
    bridge.stop();

    expect(triggers.length).toBe(0);
  });

  it('deduplicates alerts within the same day', async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    const startHhmm = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;

    clockServer = await createMockClockServer({
      rules: [{ name: '重复测试', start_hhmm: startHhmm, end_hhmm: startHhmm }],
    });

    const { engine, triggers } = makeCareEngine();
    const bridge = createScheduleBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${clockServer.port}`,
        username: 'testuser',
        pollIntervalMs: 50,
        preAlertMs: 10 * 60_000,
      },
      engine,
    );

    bridge.start();
    await new Promise(r => setTimeout(r, 400));
    bridge.stop();

    const preAlerts = triggers.filter(t => t.reason === 'schedule-pre-alert');
    expect(preAlerts.length).toBe(1);
  });
});
