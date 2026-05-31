// Pattern from PilotDeck DiscoveryScheduler.ts (AGPL, rewritten)

export type DiscoverySchedulerDeps = {
  tickIntervalMs: number;
  onTick: () => void | Promise<void>;
};

export class DiscoveryScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: DiscoverySchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.deps.tickIntervalMs);
    void this.runTick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for tests — run one tick immediately. */
  async tickNow(): Promise<void> {
    await this.runTick();
  }

  private async runTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.deps.onTick();
    } finally {
      this.ticking = false;
    }
  }
}
