import { stayPutStagesOf } from '../../core/lifecycle-stages';
import type { Clock } from '../ports/clock';
import type { RunDkTarget } from '../protocol';
import { RunLease, runOwnerId } from '../run-lease';
import type { StoreForTarget, TicketStore } from '../store/ticket-store';
import type { LiveRun } from './live-run';

/**
 * The store side every part of the runner shares (E14-5): the store of a
 * run's target, where a ticket goes back to, and the lease a run that
 * never claimed this life (a detached record being settled) releases
 * through. Holds nothing of any one supervisor, so one instance serves the
 * whole runner.
 */
export class StoreClaims {
  constructor(
    private readonly storeFor: StoreForTarget,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {}

  storeOf(target: RunDkTarget): TicketStore {
    return this.storeFor(target);
  }

  /**
   * Where a ticket goes when the run does not move it: back to where it sat (`active` for a ticket
   * the claim took from there) — one release.
   */
  stayPutStages(lease: RunLease): readonly string[] {
    return stayPutStagesOf(lease.preStage);
  }

  /**
   * The run's lease; one made here keeps no claim alive and reports no loss —
   * it only releases what an earlier runner life claimed (the run is over by
   * then, a lost claim changes nothing).
   */
  leaseOf(run: LiveRun): RunLease {
    run.lease ??= new RunLease({
      store: this.storeOf(run.request.dk!),
      ticketId: run.request.ticketId,
      actor: runOwnerId(run.info.id),
      runId: run.info.id,
      size: run.request.interactive !== undefined ? 'L' : 'S',
      log: this.log,
      now: () => this.clock.now(),
      onLost: () => undefined,
    });
    return run.lease;
  }
}
