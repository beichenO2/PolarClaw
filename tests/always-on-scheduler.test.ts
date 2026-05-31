import { describe, expect, it, vi } from 'vitest';
import { DiscoveryScheduler } from '../src/always-on/runtime/DiscoveryScheduler.js';

describe('DiscoveryScheduler', () => {
  it('invokes onTick on start and tickNow', async () => {
    vi.useFakeTimers();
    const onTick = vi.fn().mockResolvedValue(undefined);
    const scheduler = new DiscoveryScheduler({ tickIntervalMs: 60_000, onTick });

    scheduler.start();
    await Promise.resolve();
    expect(onTick).toHaveBeenCalledTimes(1);

    await scheduler.tickNow();
    expect(onTick).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(onTick).toHaveBeenCalledTimes(3);

    scheduler.stop();
    vi.useRealTimers();
  });

  it('does not overlap concurrent ticks', async () => {
    let resolveFirst: (() => void) | undefined;
    const onTick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const scheduler = new DiscoveryScheduler({ tickIntervalMs: 10, onTick });
    scheduler.start();

    const first = scheduler.tickNow();
    const second = scheduler.tickNow();
    resolveFirst?.();
    await first;
    await second;

    expect(onTick).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
