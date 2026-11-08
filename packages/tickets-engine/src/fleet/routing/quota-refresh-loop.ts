import type { SlotRegistry } from './slot-registry';

/** A one-shot timer, cancellable (`setTimeout` in the runner, a fake in specs). */
export type Schedule = (fn: () => void, ms: number) => { cancel(): void };

/**
 * The quota schedule (req-177): every `quota.refreshMinutes` the config is
 * read again (an edited `service.json` applies without a restart) and every
 * slot's quota is read. A run's end asks for its slot in between
 * (`SlotRunListener`). Stops with the runner.
 */
export class QuotaRefreshLoop {
  private timer: { cancel(): void } | null = null;
  private stopped = false;

  constructor(
    private readonly registry: Pick<SlotRegistry, 'load' | 'refresh' | 'refreshMs'>,
    private readonly schedule: Schedule,
    private readonly log: (message: string) => void,
  ) {}

  start(): void {
    this.stopped = false;
    this.next();
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = null;
  }

  /** One round now: the config, then every quota. */
  async tick(): Promise<void> {
    try {
      await this.registry.load();
      await this.registry.refresh();
    } catch (error) {
      this.log(`slot quota refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private next(): void {
    this.timer = this.schedule(() => {
      void this.tick().finally(() => {
        if (!this.stopped) {
          this.next();
        }
      });
    }, this.registry.refreshMs);
  }
}
