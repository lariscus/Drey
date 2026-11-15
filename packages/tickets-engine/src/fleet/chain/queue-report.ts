import { dispatchQueueOf } from './dispatch-queue';
import type { HolderPlan } from './holder-plan';
import type { Clock } from '../ports/clock';
import type { ChainState } from './chain-state';
import type { DispatchPool } from './dispatch-pool';

/**
 * req-148: the dispatcher's queue into the fleet report after a pass — the
 * capacity pool's queue and the holders the plan left without a place, in
 * dispatch order (`fleet/dispatch-queue.ts`); empty unless the Autopilot is On.
 */
export function reportQueue(
  state: ChainState,
  sources: { readonly pool?: DispatchPool; readonly clock: Clock },
  pass: { readonly order: readonly string[]; readonly waits: HolderPlan['waits'] },
): void {
  const pool = state.master === 'run' ? (sources.pool?.queue.list() ?? []) : [];
  state.queued = dispatchQueueOf({ order: pass.order, pool, waits: pass.waits, previous: state.queued, now: sources.clock.now().toISOString() });
}
