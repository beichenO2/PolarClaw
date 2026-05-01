import { describe, it, expect, afterEach } from 'vitest';
import { createDedup } from '../pilot/dedup.js';

describe('Dedup', () => {
  let dedup: ReturnType<typeof createDedup>;

  afterEach(() => {
    dedup?.stop();
  });

  it('allows first occurrence', () => {
    dedup = createDedup({ windowMs: 10000 });
    expect(dedup.shouldProcess('key-1')).toBe(true);
  });

  it('blocks duplicate within window', () => {
    dedup = createDedup({ windowMs: 10000 });
    expect(dedup.shouldProcess('key-1')).toBe(true);
    expect(dedup.shouldProcess('key-1')).toBe(false);
  });

  it('allows different keys', () => {
    dedup = createDedup({ windowMs: 10000 });
    expect(dedup.shouldProcess('key-a')).toBe(true);
    expect(dedup.shouldProcess('key-b')).toBe(true);
    expect(dedup.shouldProcess('key-a')).toBe(false);
  });

  it('allows after window expires', async () => {
    dedup = createDedup({ windowMs: 50 });
    expect(dedup.shouldProcess('expire-key')).toBe(true);
    expect(dedup.shouldProcess('expire-key')).toBe(false);

    await new Promise(r => setTimeout(r, 80));
    expect(dedup.shouldProcess('expire-key')).toBe(true);
  });

  it('tracks size correctly', () => {
    dedup = createDedup({ windowMs: 10000 });
    expect(dedup.size()).toBe(0);
    dedup.shouldProcess('k1');
    dedup.shouldProcess('k2');
    expect(dedup.size()).toBe(2);
  });

  it('clears all keys', () => {
    dedup = createDedup({ windowMs: 10000 });
    dedup.shouldProcess('k1');
    dedup.shouldProcess('k2');
    dedup.clear();
    expect(dedup.size()).toBe(0);
    expect(dedup.shouldProcess('k1')).toBe(true);
  });

  it('markSeen blocks subsequent process', () => {
    dedup = createDedup({ windowMs: 10000 });
    dedup.markSeen('manual-key');
    expect(dedup.shouldProcess('manual-key')).toBe(false);
  });
});
