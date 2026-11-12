import type { Clock } from '../ports/clock';
import type { RunRequest } from '../protocol';
import { dricketTrailers, RunLease, runOwnerId, trailerInstruction } from '../run-lease';
import { toDricketId } from '../../store/ids';
import type { BackgroundWork } from './background-work';
import { messageOf, type LiveRun } from './live-run';
import type { StoreClaims } from './store-claims';

/** The lease's timers (a spec's manual clock). */
export interface LeaseTimers {
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface RunClaimsDeps {
  readonly stores: StoreClaims;
  readonly log: (message: string) => void;
  readonly clock: Clock;
  readonly background: BackgroundWork;
  readonly leaseTimers?: LeaseTimers;
  /** Exit 13 (or an epoch that moved): another actor owns the ticket — the stopper stops the worker. */
  readonly onLost: (run: LiveRun, why: string) => Promise<void>;
}

/**
 * A run's claim on its dricket ticket (E14-5, ADR-0090): the lease is made
 * here, kept alive by `RunLease`, taken up again after a restart, and its
 * loss reported to the stopper.
 */
export class RunClaims {
  constructor(private readonly deps: RunClaimsDeps) {}

  newLease(request: RunRequest, runId: string, runOf: () => LiveRun | null): RunLease {
    return new RunLease({
      store: this.deps.stores.storeOf(request.dk!),
      ticketId: request.ticketId,
      actor: runOwnerId(runId),
      runId,
      // A dead runner's claim blocks the ticket for one lease: short for a run bounded by
      // max-work, long for an owner's dialog. The keep-alive extends a live run.
      size: request.interactive !== undefined ? 'L' : 'S',
      log: this.deps.log,
      now: () => this.deps.clock.now(),
      ...(this.deps.leaseTimers !== undefined ? { timers: this.deps.leaseTimers } : {}),
      onLost: (why) => {
        const run = runOf();
        if (run !== null) {
          this.deps.background.track(this.deps.onLost(run, why));
        }
      },
    });
  }

  /** A run re-attached after a restart: take the claim up again (idempotent for the same owner). */
  async resume(run: LiveRun): Promise<void> {
    if (run.request.dk === undefined) {
      return;
    }
    const lease = this.newLease(run.request, run.info.id, () => run);
    run.lease = lease;
    try {
      await lease.claim();
    } catch (error) {
      await this.deps.onLost(run, `the claim could not be taken up again - ${messageOf(error)}`);
    }
  }

  /** The trailer block for the worker's instruction, once the claim gave an epoch. */
  trailerBlock(run: LiveRun): string | null {
    const trailers = this.trailers(run, 'work');
    return trailers === null ? null : trailerInstruction(trailers);
  }

  /** The claim's trailer lines for a commit made in it (`op`: the worker's `work`, a leaving action's own); null without trailers. */
  trailers(run: LiveRun, op: string): readonly string[] | null {
    const target = run.request.dk;
    const lease = run.lease;
    if (target === undefined || !target.trailers || lease === undefined || lease.epoch === null) {
      return null;
    }
    const id = toDricketId(run.request.ticketId);
    return id === null ? null : dricketTrailers({ dricketId: id, epoch: lease.epoch, actor: lease.actor, op });
  }
}
