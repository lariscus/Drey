/**
 * The wiring of the resource governor (req-180, ADR-0096): every part built
 * once and handed its collaborators by constructor; `runner.ts` calls it
 * with the Node adapters, a spec with fakes. Also the one adapter from the
 * governor's port to the consumer interfaces the orchestration declares
 * (`WorkerSeats`, `GateSeats`): a gate command's task is named here.
 */
import { Admission } from './governor/admission';
import { GovernorPublisher } from './governor/governor-publisher';
import { GovernorSweep, type GovernorProcesses } from './governor/governor-sweep';
import { GovernorTicker, type GovernorTimers } from './governor/governor-timers';
import { heavyTaskOf } from './governor/heavy-task';
import { LoadGuard } from './governor/load-guard';
import { PortLeases } from './governor/port-leases';
import type { ResourceGovernor } from './governor/resource-governor';
import { SeatGovernor } from './governor/seat-governor';
import { SeatTable } from './governor/seat-table';
import type { GateSeats } from './orchestrate/gate-runner';
import type { WorkerSeats } from './orchestrate/worker-launcher';
import type { Clock } from './ports/clock';
import type { EventSink } from './ports/event-sink';
import type { ProcessPriority } from './ports/process-priority';
import type { SystemLoad } from './ports/system-load';
import { DEFAULT_DEV_PORTS, type GovernorSettings, type PortRange } from './protocol-governor';

/** The machine the governor runs on. */
export interface GovernorPorts {
  readonly load: SystemLoad;
  readonly priority: ProcessPriority;
  readonly processes: GovernorProcesses;
  readonly clock: Clock;
  readonly sink: EventSink;
  readonly timers: GovernorTimers;
}

export interface GovernorOptions {
  /** The Load group, read live (the service's settings; the defaults standalone). */
  readonly settings: () => GovernorSettings;
  readonly log: (message: string) => void;
  /** The light seats' total (the slots' sessions summed). */
  readonly lightTotal: () => number | null;
  readonly devPorts?: PortRange;
  readonly maxLoadWaitMs?: number;
  readonly tickMs?: number;
  readonly sweepMs?: number;
}

/** The governor and its ticker: start the ticker once the runner serves, stop it when it leaves. */
export interface Governor {
  readonly governor: ResourceGovernor;
  readonly ticker: GovernorTicker;
}

export function composeGovernor(opts: GovernorOptions, ports: GovernorPorts): Governor {
  const { settings } = opts;
  const { clock, priority, processes } = ports;
  const table = new SeatTable();
  const guard = new LoadGuard(ports.load);
  const leases = new PortLeases(opts.devPorts ?? DEFAULT_DEV_PORTS);
  const publisher = new GovernorPublisher(opts.log, ports.sink);
  const governor = new SeatGovernor({
    settings,
    table,
    guard,
    admission: new Admission({ settings, table, guard, clock, maxLoadWaitMs: opts.maxLoadWaitMs ?? 10 * 60_000 }),
    ports: leases,
    priority,
    sweep: new GovernorSweep({ table, ports: leases, processes, priority, settings, publisher, clock }),
    publisher,
    clock,
    lightTotal: opts.lightTotal,
  });
  return { governor, ticker: new GovernorTicker(ports.timers, { tickMs: opts.tickMs ?? 5_000, sweepMs: opts.sweepMs ?? 30_000 }) };
}

/** The governor as the worker launcher, the gate and the ci check ask it. */
export function governorSeats(governor: ResourceGovernor): WorkerSeats & GateSeats {
  return {
    light: (ask) => governor.light(ask),
    heavy: (ask) => governor.heavy({ ...ask, task: heavyTaskOf(ask.command) }),
  };
}

/** Node's repeating timer, unref'd so it never keeps a process up. */
export const NODE_TIMERS: GovernorTimers = {
  every: (ms, fn) => {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  },
};
