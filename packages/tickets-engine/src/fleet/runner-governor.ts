/**
 * The resource governor as the runner's composition root builds it
 * (req-180): the Node adapters, the dev-port range out of `service.json`,
 * the light seats' total from the slots, and the seeds a restart finds.
 */
import * as path from 'node:path';
import { composeGovernor, NODE_TIMERS, type Governor } from './compose-governor';
import { devPortRangeOf } from './governor/dev-port-range';
import type { SeatSeed } from './governor/resource-governor';
import { NodeFileSystem } from './node-file-system';
import { NodeProcessPriority } from './node-process-priority';
import { NodeProcessTable } from './node-process-table';
import { NodeSystemLoad } from './node-system-load';
import { SYSTEM_CLOCK } from './ports/clock';
import type { EventSink } from './ports/event-sink';
import type { RunInfo, SlotView } from './protocol';
import { DEFAULT_GOVERNOR_SETTINGS, type GovernorSettings } from './protocol-governor';
import { isTerminal } from './run/run-state';
import { probeExec } from './shell-exec';

export interface RunnerGovernorContext {
  /** The fleet root (the process probes' cwd). */
  readonly root: string;
  /** The service home: `service.json` names the dev-port range. */
  readonly home: string;
  readonly log: (message: string) => void;
  readonly sink: EventSink;
  /** The slots as they are now (the light seats' total). */
  readonly slots: () => readonly SlotView[];
  /** The Load group, live; the defaults when the runner runs standalone. */
  readonly settings?: () => GovernorSettings;
}

/** Light seats in total: the slots' sessions summed, null while a slot has no cap of its own. */
export function lightTotalOf(slots: readonly SlotView[]): number | null {
  let total = 0;
  for (const slot of slots) {
    if (slot.total === null) {
      return null;
    }
    total += slot.total;
  }
  return slots.length === 0 ? null : total;
}

export async function governorFor(ctx: RunnerGovernorContext): Promise<Governor> {
  const devPorts = devPortRangeOf(await new NodeFileSystem().readTextOrNull(path.join(ctx.home, 'service.json')).catch(() => null));
  return composeGovernor(
    { settings: ctx.settings ?? ((): GovernorSettings => DEFAULT_GOVERNOR_SETTINGS), log: ctx.log, lightTotal: () => lightTotalOf(ctx.slots()), devPorts },
    { load: new NodeSystemLoad(), priority: new NodeProcessPriority(), processes: new NodeProcessTable(probeExec(ctx.root)), clock: SYSTEM_CLOCK, sink: ctx.sink, timers: NODE_TIMERS },
  );
}

/** The live runs a restart adopted: their workers' light seats and their worktrees' ports. */
export function seedsOf(runs: readonly RunInfo[]): readonly SeatSeed[] {
  return runs
    .filter((run) => !isTerminal(run.state))
    .map((run) => ({ runId: run.id, ticket: run.ticketId, worktree: run.worktreePath, pid: run.pid, devPort: run.devPort ?? null }));
}
