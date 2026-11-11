import { stayPutStagesOf } from '../../core/lifecycle-stages';
import type { Clock } from '../ports/clock';
import type { RunDkTarget, RunRequest } from '../protocol';
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
   * Where a ticket goes when the run does not move it: on a lifecycle store back to where it sat
   * (`active` for a ticket the claim took from there) — one release; on a store still on phase
   * stages back to where it sat, else the stage before (R-31).
   */
  stayPutStages(request: RunRequest, lease: RunLease): readonly (string | null)[] {
    return request.dk?.lifecycle === true ? stayPutStagesOf(lease.preStage) : [lease.preStage, request.dk?.retreatStage ?? null];
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
