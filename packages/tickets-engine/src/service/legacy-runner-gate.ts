/**
 * The pre-service fleet runner's handover (req-164 migration): asked at
 * boot and, while it refuses (a run in its gate), every tick — the
 * service's Crew runner stays blocked until the old one has gone, then
 * wakes for the runs it handed over.
 */
import * as path from 'node:path';
import { hasHandedOverRuns, retireLegacyRunner, type LegacyDeps } from './legacy';

/** What the gate drives of the Crew runner component. */
export interface BlockableRunner {
  block(reason: string | null): void;
  wake(): Promise<unknown>;
}

type Log = (component: 'service' | 'runner', message: string, level?: 'info' | 'warn') => void;

export class LegacyRunnerGate {
  private isBusy = false;

  constructor(
    private readonly home: string,
    private readonly runner: BlockableRunner,
    private readonly log: Log,
    private readonly legacy?: LegacyDeps,
  ) {}

  get busy(): boolean {
    return this.isBusy;
  }

  async check(): Promise<void> {
    const outcome = await retireLegacyRunner(this.home, (message) => this.log('service', message), this.legacy).catch((error: unknown) => {
      this.log('service', `retiring the old runner failed: ${String(error)}`, 'warn');
      return { kind: 'none' } as const;
    });
    if (outcome.kind === 'busy') {
      if (!this.isBusy) {
        this.log('runner', `an older fleet runner (pid ${outcome.pid}) is still busy: ${outcome.reason} — asked again every tick`, 'warn');
      }
      this.isBusy = true;
      this.runner.block(`an older fleet runner (pid ${outcome.pid}) hands its runs over once it is free: ${outcome.reason}`);
      return;
    }
    if (this.isBusy) {
      this.isBusy = false;
      this.runner.block(null);
      if (await hasHandedOverRuns(path.join(this.home, 'fleet'))) {
        void this.runner.wake();
      }
    }
  }
}
