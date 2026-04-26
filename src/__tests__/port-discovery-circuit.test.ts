import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  getCircuit,
  recordSuccess,
  recordFailure,
  isCircuitOpen,
  resilientFetch,
} from '../../skills/_shared/port-discovery.js';

const SVC = (id: string) => `test-cb-${id}-${Date.now()}`;

describe('port-discovery CircuitBreaker', () => {
  beforeEach(() => {
    // state is per service name; each test uses unique SVC
  });

  it('opens circuit after 3 consecutive failures', () => {
    const name = SVC('open');
    expect(isCircuitOpen(name)).toBe(false);
    recordFailure(name);
    recordFailure(name);
    expect(isCircuitOpen(name)).toBe(false);
    recordFailure(name);
    expect(isCircuitOpen(name)).toBe(true);
  });

  it('resets to closed on success', () => {
    const name = SVC('reset');
    recordFailure(name);
    recordSuccess(name);
    expect(getCircuit(name).state).toBe('closed');
    expect(getCircuit(name).failures).toBe(0);
  });

  it('resilientFetch returns circuitOpen when circuit is open', async () => {
    const name = SVC('rf');
    recordFailure(name);
    recordFailure(name);
    recordFailure(name);
    const r1 = await resilientFetch(name, 'http://127.0.0.1:1', {}, 200);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.circuitOpen).toBe(true);
  });

  it('resilientFetch handles non-OK HTTP without throwing', async () => {
    const name = SVC('http500');
    let s: Server;
    const port = await new Promise<number>((resolve) => {
      s = createServer((_, res) => {
        res.writeHead(500);
        res.end();
      });
      s.listen(0, '127.0.0.1', () => {
        const a = s.address();
        resolve(typeof a === 'object' && a ? a.port : 0);
      });
    });
    const r = await resilientFetch<unknown>(name, `http://127.0.0.1:${port}`, {}, 3000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/500/);
    await new Promise<void>((res) => s!.close(() => res()));
  });

  it('concurrent failed requests do not throw (stress-lite on breaker)', async () => {
    const name = SVC('conc');
    const port = 1; // closed port — all fail fast
    const tasks = Array.from({ length: 12 }, () =>
      resilientFetch(name, `http://127.0.0.1:${port}/`, {}, 1000),
    );
    const results = await Promise.all(tasks);
    for (const r of results) {
      expect(r.ok).toBe(false);
    }
    expect(isCircuitOpen(name)).toBe(true);
  });
});
