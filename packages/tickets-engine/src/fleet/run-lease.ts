import { TicketStoreError, type Claim, type TicketStore } from '../ports/ticket-store';
import { withStage } from './run-lease-text';

export { dricketTrailers, runOwnerId, trailerInstruction, withStage } from './run-lease-text';

/**
 * The run's claim on a dricket ticket (E14-5, ADR-0090 decision 2). One
 * {@link RunLease} per run: the runner claims through `dk` BEFORE the worker
 * spawns, keeps the lease alive while the worker lives, and gives the ticket up
 * with a target stage and a message. Everything about claims is dk's decision —
 * the lease length by size, the epoch, takeover after `lease_until` + grace,
 * the stage rules; this class only sequences the calls and reacts to exit 13
 * (`claim-lost`): the epoch moved on, another actor owns the ticket, the worker
 * must stop and nothing more is written to the ticket.
 *
 * Workers never see `dk` or its identity: the runner is the only caller
 * (ADR-0076's single-writer rule stands).
 */

/** The longest wait before a lease check; also what an unreadable `lease_until` falls back to. */
const FALLBACK_EXTEND_MS = 30 * 60_000;
/** Never extend more often than this, however short the lease. */
const MIN_EXTEND_MS = 30_000;
/** A failed extension (network, busy store) is retried after this. */
const RETRY_EXTEND_MS = 60_000;

export interface LeaseReleaseOptions {
  /**
   * The stage the ticket should END in when the release itself may not stay put (R-31: dk
   * refuses an agent's `build -> build` release). If this candidate was refused and a later one
   * took the ticket, one `put --claim` writes it back — dk allows the move once nobody holds the
   * ticket. Two commits and a short stop in the retreat stage, but the card ends where it sat.
   */
  readonly restoreTo?: string | null;
}

export type LeaseRelease =
  | { readonly ok: true; readonly stage: string }
  | { readonly ok: false; readonly lost: boolean; readonly error: string };

const LOST_RELEASE: LeaseRelease = { ok: false, lost: true, error: 'the claim was lost - nothing is written' };

/** One `dk release` to one stage. */
type ReleaseAttempt =
  | { readonly kind: 'released'; readonly stage: string }
  | { readonly kind: 'lost' | 'invalid' | 'failed'; readonly error: string };

export interface RunLeaseOptions {
  readonly store: TicketStore;
  readonly ticketId: string;
  readonly actor: string;
  readonly runId: string;
  readonly size: 'S' | 'M' | 'L';
  readonly log: (message: string) => void;
  /** Called once when dk reports exit 13: stop the worker, write nothing more. */
  readonly onLost: (why: string) => void;
  readonly now?: () => Date;
  /** Test seam over the timers. */
  readonly timers?: {
    readonly set: (fn: () => void, ms: number) => unknown;
    readonly clear: (handle: unknown) => void;
  };
}

export class RunLease {
  /** The fencing token the claim returned; null before the claim and for a store without epochs. */
  epoch: number | null = null;
  leaseUntil: string | null = null;
  /** True when the claim was a takeover of an expired lease. */
  takeover = false;
  /** The stage the ticket sat in before the claim (dk may have moved it to a claim stage). */
  preStage: string | null = null;
  /** Another actor owns the ticket now: no further call is made. */
  fenced = false;
  /** The ticket was handed back (release / park); the keep-alive is over. */
  released = false;

  private timer: unknown = null;
  private extendStopped = false;
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: RunLeaseOptions) {
    this.now = options.now ?? ((): Date => new Date());
    this.setTimer = options.timers?.set ?? ((fn, ms): unknown => setTimeout(fn, ms));
    this.clearTimer = options.timers?.clear ?? ((handle): void => clearTimeout(handle as NodeJS.Timeout));
  }

  get actor(): string {
    return this.options.actor;
  }

  /**
   * `dk claim` — idempotent for the same owner (no commit), a takeover when the
   * previous lease ran out past the grace. Throws the {@link TicketStoreError}
   * of dk (exit 11: someone else holds the ticket). On success the keep-alive runs.
   */
  async claim(): Promise<Claim> {
    try {
      this.preStage = (await this.options.store.show(this.options.ticketId)).stage;
    } catch {
      this.preStage = null; // best effort: only the stay-put release uses it
    }
    const claim = await this.options.store.claim(this.options.ticketId, {
      actor: this.options.actor,
      size: this.options.size,
      kind: 'agent',
    });
    this.epoch = claim.epoch;
    this.leaseUntil = claim.leaseUntil;
    this.takeover = claim.takeover;
    this.released = false;
    this.fenced = false;
    this.extendStopped = false;
    this.options.log(
      `run ${this.options.runId}: claimed ${this.options.ticketId} as ${this.options.actor}` +
        (claim.epoch !== null ? ` (epoch ${claim.epoch}${claim.takeover ? ', takeover of an expired lease' : ''})` : '') +
        (claim.leaseUntil !== null ? `, lease until ${claim.leaseUntil}` : ''),
    );
    this.scheduleExtend();
    return claim;
  }

  /**
   * Hands the ticket back to the first stage dk accepts. `candidates` are tried in
   * order; an `invalid` answer (exit 14: unknown stage, or the agent policy refuses
   * a same-stage release) goes on to the next one. Exit 13 fences the lease.
   *
   * `note` becomes a COMMENT before the release, never `release -m`: dk's `-m` replaces
   * body chapters between `## Result` and `## Log` (dricket requirement R-21, open),
   * and Drey's tickets keep several chapters there.
   */
  async release(candidates: readonly (string | null)[], note: string | null, options: LeaseReleaseOptions = {}): Promise<LeaseRelease> {
    if (this.fenced) {
      return LOST_RELEASE;
    }
    this.stopKeepAlive();
    if (note !== null && note !== '') {
      await this.comment(note);
      if (this.fenced) {
        return LOST_RELEASE;
      }
    }
    const stages = [...new Set(candidates.filter((s): s is string => s !== null && s !== ''))];
    return this.releaseToFirst(stages, options.restoreTo ?? null);
  }

  /** Tries each stage in order until dk accepts one; only an `invalid` answer goes on to the next. */
  private async releaseToFirst(stages: readonly string[], restoreTo: string | null): Promise<LeaseRelease> {
    let last = 'no target stage';
    let restoreRefused = false;
    for (const stage of stages.length > 0 ? stages : [undefined]) {
      const attempt = await this.releaseOnce(stage);
      if (attempt.kind === 'released') {
        return this.afterRelease(attempt.stage, restoreRefused ? restoreTo : null);
      }
      if (attempt.kind === 'lost') {
        return { ok: false, lost: true, error: attempt.error };
      }
      last = attempt.error;
      restoreRefused ||= attempt.kind === 'invalid' && stage !== undefined && stage === restoreTo;
      if (attempt.kind !== 'invalid') {
        break; // a network or store failure does not get better with another stage
      }
    }
    return { ok: false, lost: false, error: last };
  }

  private async releaseOnce(stage: string | undefined): Promise<ReleaseAttempt> {
    try {
      const answer = await this.options.store.release(this.options.ticketId, {
        actor: this.options.actor,
        ...(stage === undefined ? {} : { stage }),
      });
      this.released = true;
      return { kind: 'released', stage: answer.stage };
    } catch (error) {
      if (error instanceof TicketStoreError && error.kind === 'claim-lost') {
        this.fence(error.message);
        return { kind: 'lost', error: error.message };
      }
      const invalid = error instanceof TicketStoreError && error.kind === 'invalid';
      return { kind: invalid ? 'invalid' : 'failed', error: errorText(error) };
    }
  }

  /** `restoreTo` is set when the stage to restore was refused and the release had to retreat. */
  private async afterRelease(stage: string, restoreTo: string | null): Promise<LeaseRelease> {
    if (restoreTo !== null && stage !== restoreTo) {
      const restored = await this.restoreStage(restoreTo);
      return { ok: true, stage: restored ? restoreTo : stage };
    }
    return { ok: true, stage };
  }

  /**
   * Writes the ticket back into `stage` after a release that had to retreat (R-31, E14-5b): the
   * ticket is nobody's now, so `put --claim --if-version` may move it. A failure is a log line —
   * the ticket then simply stays in the retreat stage, as it did before this write existed.
   */
  private async restoreStage(stage: string): Promise<boolean> {
    const store = this.options.store;
    if (store.put === undefined) {
      return false;
    }
    try {
      const detail = await store.show(this.options.ticketId);
      if (detail.stage === stage || detail.rev === null) {
        return detail.stage === stage;
      }
      const text = withStage(detail.text, stage);
      if (text === null) {
        return false;
      }
      await store.put(this.options.ticketId, text, { expectedRev: detail.rev, actor: this.options.actor });
      return true;
    } catch (error) {
      this.options.log(`run ${this.options.runId}: ${this.options.ticketId} stays in its retreat stage - the way back to ${stage} failed: ${errorText(error)}`);
      return false;
    }
  }

  /**
   * One read-modify-write of the ticket INSIDE the claim (`## Verlauf`, the settle's chapters): `dk put`
   * without `--claim`. Returns false (and logs) when the store cannot, the claim is gone or the
   * patch changed nothing; exit 13 fences the lease. Never throws: a chapter is not worth a failed run.
   */
  async patchInClaim(patch: (text: string) => string): Promise<boolean> {
    const store = this.options.store;
    if (this.fenced || this.released || store.put === undefined) {
      return false;
    }
    try {
      const detail = await store.show(this.options.ticketId);
      const next = patch(detail.text);
      if (next === detail.text) {
        return false;
      }
      await store.put(this.options.ticketId, next, { holdsClaim: true, actor: this.options.actor });
      return true;
    } catch (error) {
      if (error instanceof TicketStoreError && error.kind === 'claim-lost') {
        this.fence(error.message);
      } else {
        this.options.log(`run ${this.options.runId}: writing ${this.options.ticketId} inside the claim failed - ${errorText(error)}`);
      }
      return false;
    }
  }

  /**
   * Takes the ticket up again after a release made for a wait (Q-03: a run that waits for the
   * owner gives the claim up and re-claims on the answer — a new epoch). Throws dk's error when
   * another actor holds the ticket now (exit 11); the caller tells the owner.
   */
  async reclaim(): Promise<Claim> {
    const claim = await this.options.store.claim(this.options.ticketId, {
      actor: this.options.actor,
      size: this.options.size,
      kind: 'agent',
    });
    this.epoch = claim.epoch;
    this.leaseUntil = claim.leaseUntil;
    this.released = false;
    this.fenced = false;
    this.extendStopped = false;
    this.options.log(`run ${this.options.runId}: re-claimed ${this.options.ticketId}${claim.epoch !== null ? ` (epoch ${claim.epoch})` : ''}`);
    this.scheduleExtend();
    return claim;
  }

  /** A comment on the ticket (park notes); a failure is a log line, never a failed run. */
  async comment(text: string): Promise<boolean> {
    if (this.fenced) {
      return false;
    }
    try {
      await this.options.store.comment(this.options.ticketId, text, { actor: this.options.actor });
      return true;
    } catch (error) {
      if (error instanceof TicketStoreError && error.kind === 'claim-lost') {
        this.fence(error.message);
      } else {
        this.options.log(`run ${this.options.runId}: comment on ${this.options.ticketId} failed - ${errorText(error)}`);
      }
      return false;
    }
  }

  stopKeepAlive(): void {
    this.extendStopped = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Exit 13 seen anywhere: the claim is gone for good. */
  fence(why: string): void {
    if (this.fenced) {
      return;
    }
    this.fenced = true;
    this.stopKeepAlive();
    this.options.onLost(why);
  }

  private scheduleExtend(): void {
    if (this.extendStopped || this.fenced || this.released) {
      return;
    }
    const until = this.leaseUntil === null ? Number.NaN : Date.parse(this.leaseUntil);
    const left = Number.isNaN(until) ? FALLBACK_EXTEND_MS * 2 : until - this.now().getTime();
    this.arm(Math.max(MIN_EXTEND_MS, Math.floor(left / 2)));
  }

  private arm(ms: number): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
    }
    this.timer = this.setTimer(() => void this.extendOnce(), ms);
    (this.timer as { unref?: () => void } | null)?.unref?.();
  }

  private async extendOnce(): Promise<void> {
    this.timer = null;
    if (this.extendStopped || this.fenced || this.released) {
      return;
    }
    try {
      const extended = await this.options.store.extend(this.options.ticketId, {
        actor: this.options.actor,
        reason: `run ${this.options.runId} is still working`,
      });
      this.leaseUntil = extended.leaseUntil ?? this.leaseUntil;
      if (extended.epoch !== null && this.epoch !== null && extended.epoch !== this.epoch) {
        this.fence(`epoch moved from ${this.epoch} to ${extended.epoch}`);
        return;
      }
      this.scheduleExtend();
    } catch (error) {
      this.extendFailed(error);
    }
  }

  private extendFailed(error: unknown): void {
    if (error instanceof TicketStoreError && error.kind === 'claim-lost') {
      this.fence(error.message);
      return;
    }
    if (error instanceof TicketStoreError && (error.kind === 'invalid' || error.kind === 'forbidden')) {
      // The extension budget is spent: the lease runs out on its own; keep working until dk says no.
      this.options.log(`run ${this.options.runId}: ${this.options.ticketId} lease not extended - ${error.message}`);
      this.extendStopped = true;
      return;
    }
    this.options.log(`run ${this.options.runId}: lease extension of ${this.options.ticketId} failed (retrying) - ${errorText(error)}`);
    this.arm(RETRY_EXTEND_MS);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
