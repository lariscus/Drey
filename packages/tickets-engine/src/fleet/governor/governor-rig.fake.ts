import type { Clock } from '../ports/clock';
import type { RunnerEvent } from '../ports/event-sink';
import { FakeProcessPriority } from '../ports/process-priority.fake';
import { FakeSystemLoad } from '../ports/system-load.fake';
import { DEFAULT_GOVERNOR_SETTINGS, type GovernorSettings } from '../protocol-governor';
import { Admission } from './admission';
import { GovernorPublisher } from './governor-publisher';
import { GovernorSweep, type GovernorProcesses } from './governor-sweep';
import { LoadGuard } from './load-guard';
import { PortLeases } from './port-leases';
import { SeatGovernor } from './seat-governor';
import { SeatTable } from './seat-table';

/** Liveness and listeners a spec sets. */
export class FakeGovernorProcesses implements GovernorProcesses {
  readonly dead = new Set<number>();
  readonly listeners = new Map<number, number>();

  alive(pid: number): Promise<boolean> {
    return Promise.resolve(!this.dead.has(pid));
  }

  listener(port: number): Promise<number | null> {
    return Promise.resolve(this.listeners.get(port) ?? null);
  }
}

/** A movable clock. */
export class ManualClock implements Clock {
  constructor(public at: Date = new Date(2026, 10, 9, 12, 0)) {}

  now(): Date {
    return this.at;
  }

  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
}

/** A SeatGovernor over fakes: settings, load, clock, processes, priority; the log lines and events recorded. */
export class GovernorRig {
  settings: GovernorSettings = { ...DEFAULT_GOVERNOR_SETTINGS };
  lightTotal: number | null = 6;
  readonly clock = new ManualClock();
  readonly load = new FakeSystemLoad();
  readonly priority = new FakeProcessPriority();
  readonly processes = new FakeGovernorProcesses();
  readonly lines: string[] = [];
  readonly events: RunnerEvent[] = [];
  readonly table = new SeatTable();
  readonly ports = new PortLeases({ from: 4300, to: 4302 });
  readonly governor: SeatGovernor;

  constructor(maxLoadWaitMs = 10 * 60_000) {
    const settings = (): GovernorSettings => this.settings;
    const publisher = new GovernorPublisher((line) => this.lines.push(line), { publish: (event) => this.events.push(event) });
    const guard = new LoadGuard(this.load);
    const { table, ports, clock, priority, processes } = this;
    this.governor = new SeatGovernor({
      settings,
      table,
      guard,
      admission: new Admission({ settings, table, guard, clock, maxLoadWaitMs }),
      ports,
      priority,
      sweep: new GovernorSweep({ table, ports, processes, priority, settings, publisher, clock }),
      publisher,
      clock,
      lightTotal: () => this.lightTotal,
    });
  }

  ask(runId: string, ticket = runId, extra: { task?: 'tests' | 'build'; worktree?: string } = {}): { runId: string; ticket: string; task: 'tests' | 'build'; worktree: string } {
    return { runId, ticket, task: extra.task ?? 'tests', worktree: extra.worktree ?? `/wt/${runId}` };
  }
}

/** Lets pending promise callbacks run. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
