import type { HandoverDecision } from '../handover';
import type { Clock } from '../ports/clock';
import type { ReviewCheckoutRecord, RunInfo, RunRequest } from '../protocol';
import type { RunLease } from '../run-lease';
import type { StartOutcome } from '../run/run-record';
import { INITIAL_RUN_STATE, isTerminal } from '../run/run-state';
import type { RunStateMachine } from '../run/run-state-machine';
import type { PreparedWorktree } from '../worktrees';
import { messageOf, newLiveRun, type LiveRun } from './live-run';
import { newRunInfo, openingNotes, type RunOpening } from './opening-notes';
import { validateRequest } from './request-validation';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunClaims } from './run-claims';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';
import type { StoreClaims } from './store-claims';
import type { SessionHandover } from './session-handover';
import type { SlotBinder, SlotBinding } from './slot-binder';
import type { WorkerLauncher } from './worker-launcher';

/** Prepares a worktree for a request at a path (T-0044's healing included). */
export type PrepareWorktree = (request: RunRequest, worktreePath: string) => Promise<PreparedWorktree>;

export interface RunStarterDeps {
  readonly machine: RunStateMachine;
  readonly repo: RunRepository;
  readonly streams: RunStreams;
  readonly stores: StoreClaims;
  readonly claims: RunClaims;
  readonly bookkeeper: RunBookkeeper;
  readonly sessions: SessionHandover;
  readonly launcher: WorkerLauncher;
  readonly prepareWorktree: PrepareWorktree;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The runner is handing over to a newer build: it starts nothing new (req-51). */
  readonly retiring: () => boolean;
  /** req-177: the slot (account) a run starts on; absent = no slots, every older wiring. */
  readonly slots?: SlotBinder;
  /** req-183: opens a review run's read-only checkout; absent = no review checkouts (a spec). */
  readonly review?: ReviewOpener;
}

/** The review checkout as the starter asks it (req-183). */
export interface ReviewOpener {
  open(request: RunRequest): Promise<ReviewCheckoutRecord | null>;
}

/** What a run's preparation produced: the worktree (null on a scout run) and a review's checkout. */
interface Prepared {
  readonly worktree: PreparedWorktree | null;
  readonly review: ReviewCheckoutRecord | null;
}

/** How a start was asked for beyond its request. */
export interface StartAsk {
  readonly persona?: string | null;
  /** The session to resume explicitly (a resume, a reopen) — it skips the handover resolution. */
  readonly resumeRef?: string | null;
  /** An ended run's session the owner reopened: held, no gate, no move, the ticket left alone. */
  readonly reopened?: boolean;
}

/**
 * A run's start (ADR-0075): the rules, the claim FIRST (a ticket someone
 * else holds refuses before a worktree is prepared or a worker spawns), the
 * worktrees, the session handover (T-0049), the record and its opening
 * lines, then the worker — quiet and held for an interactive dialog
 * (req-65/75), held for a reopened session.
 */
export class RunStarter {
  constructor(private readonly deps: RunStarterDeps) {}

  async start(request: RunRequest, ask: StartAsk = {}): Promise<StartOutcome> {
    const reopened = ask.reopened === true;
    const refusal = this.refusal(request, reopened);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const stamp = this.deps.clock.now().toISOString();
    const id = `R-${stamp.replaceAll(/[-:.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.deps.log(`run ${id} (${request.ticketId}): asked by ${request.origin ?? 'a reopened session'}`);
    const slot = this.bindSlot(request, id, ask);
    if (typeof slot === 'string') {
      return { ok: false, error: slot };
    }
    const outcome = await this.startBound({ id, request, ask, slot, stamp });
    if (!outcome.ok) {
      this.deps.slots?.release(id);
    }
    return outcome;
  }

  /** The claim, the worktrees, the session and the record of a start whose slot is bound. */
  private async startBound(start: { id: string; request: RunRequest; ask: StartAsk; slot: SlotBinding | null; stamp: string }): Promise<StartOutcome> {
    const { id, request, ask, slot, stamp } = start;
    const claimed = await this.claim(request, id);
    if (typeof claimed === 'string') {
      return { ok: false, error: claimed };
    }
    const prepared = await this.prepare(request, id, claimed);
    if (typeof prepared === 'string') {
      return { ok: false, error: prepared };
    }
    const session = this.session(id, request, ask, prepared.worktree);
    const opening: RunOpening = { id, request, prepared: prepared.worktree, review: prepared.review, ...session, persona: ask.persona ?? null, stamp, slot };
    return this.open(opening, ask.reopened === true, claimed);
  }

  /** req-177: the slot the run starts on, the refusal when none serves, null without slots. */
  private bindSlot(request: RunRequest, id: string, ask: StartAsk): SlotBinding | null | string {
    const slots = this.deps.slots;
    if (slots === undefined) {
      return null;
    }
    const bound = slots.bind(request, id, { prefer: this.preferredSlot(request, ask), persona: ask.persona ?? null });
    if ('refused' in bound) {
      this.deps.log(`run ${id} (${request.ticketId}): refused — ${bound.refused}`);
      return bound.refused;
    }
    if (bound.grant?.route !== undefined) {
      this.deps.log(bound.grant.route.line); // req-178: every routing decision, once, in the runner log
    }
    return bound;
  }

  /** The slot the resumed session lives on: the explicit session's run, else the ticket's latest run with a slot. */
  private preferredSlot(request: RunRequest, ask: StartAsk): string | null {
    const records = this.deps.repo.list();
    if (ask.resumeRef !== undefined && ask.resumeRef !== null) {
      return records.find((r) => r.sessionRef === ask.resumeRef)?.slot?.id ?? null;
    }
    const ofTicket = records.filter((r) => r.ticketId === request.ticketId && r.slot !== undefined);
    return ofTicket.reduce<RunInfo | null>((latest, r) => (latest === null || r.startedAt > latest.startedAt ? r : latest), null)?.slot?.id ?? null;
  }

  /**
   * The session to resume: an explicit one (a resume, a reopen) skips the
   * handover resolution (T-0049); otherwise the rules decide, after the
   * worktree preparation told whether it invalidated earlier sessions.
   */
  private session(id: string, request: RunRequest, ask: StartAsk, prepared: PreparedWorktree | null): { decision: HandoverDecision | null; resumeRef: string | null } {
    const explicit = ask.resumeRef ?? null;
    if (explicit !== null || ask.reopened === true) {
      return { decision: null, resumeRef: explicit };
    }
    const decision = this.deps.sessions.resolve(request, prepared?.sessionInvalidated ?? false);
    if (decision !== null) {
      this.deps.log(`run ${id} (${request.ticketId}): handover ${decision.mode} — ${decision.why}`);
    }
    return { decision, resumeRef: decision?.resumeRef ?? null };
  }

  private refusal(request: RunRequest, reopened: boolean): string | null {
    if (this.deps.retiring()) {
      return 'the runner is handing over to a newer build — try again in a moment';
    }
    const live = this.deps.repo.list().find((r) => r.ticketId === request.ticketId && !isTerminal(r.state) && r.state !== 'detached');
    if (live !== undefined) {
      return `${request.ticketId} already has a live run (${live.id}) — stop it first`;
    }
    // req-183: the builder's process has ended before a review starts — a detached worker may still write.
    const detached = request.reviewCheckout !== undefined ? this.deps.repo.list().find((r) => r.ticketId === request.ticketId && r.state === 'detached') : undefined;
    if (detached !== undefined) {
      return `${request.ticketId} has a detached run (${detached.id}) whose worker may still live — the review starts once it has ended`;
    }
    // A reopened session belongs to a ticket that may have moved on since.
    const failures = reopened ? [] : validateRequest(request);
    return failures.length > 0 ? failures.join(' ') : null;
  }

  /** E14-5: on a store the claim comes first; the lease, null without a store target, or the refusal. */
  private async claim(request: RunRequest, id: string): Promise<RunLease | null | string> {
    if (request.dk === undefined) {
      return null;
    }
    const lease = this.deps.claims.newLease(request, id, () => this.deps.repo.find(id) ?? null);
    try {
      await lease.claim();
      return lease;
    } catch (error) {
      return `${request.ticketId} could not be claimed through dk - ${messageOf(error)}`;
    }
  }

  /**
   * The run's folder, the worker's ticket copy and the worktrees: the
   * primary's and one per further repo (req-72), same branch. A scout run
   * (E8) prepares none — it reads the named checkouts in place. A review
   * (req-183) also gets its read-only checkout at the branch's commit.
   */
  private async prepare(request: RunRequest, id: string, lease: RunLease | null): Promise<Prepared | string> {
    try {
      await this.deps.repo.ensureDir(this.deps.repo.dirFor(id));
      if (lease !== null) {
        await this.deps.bookkeeper.writeCopy(request, this.deps.repo.dirFor(id));
      }
      if (request.form === 'scout') {
        return { worktree: null, review: null };
      }
      const worktree = await this.deps.prepareWorktree(request, request.worktreePath);
      for (const extra of request.extraRepos ?? []) {
        const links = extra.links !== undefined ? { links: extra.links } : {};
        await this.deps.prepareWorktree({ ...request, repoPath: extra.repoPath, baseRef: extra.baseRef, ...links }, extra.worktreePath);
      }
      const review = (await this.deps.review?.open(request)) ?? null;
      return { worktree, review };
    } catch (error) {
      if (lease !== null) {
        await lease.release(this.deps.stores.stayPutStages(request, lease), `run ${id} did not start - worktree failed: ${messageOf(error)}`);
      }
      return `worktree failed: ${messageOf(error)}`;
    }
  }

  /** The record, its opening lines, then the worker. */
  private async open(opening: RunOpening, reopened: boolean, lease: RunLease | null): Promise<StartOutcome> {
    const { id, request, decision, resumeRef } = opening;
    const run = newLiveRun({
      info: newRunInfo(opening, INITIAL_RUN_STATE),
      request,
      dir: this.deps.repo.dirFor(id),
      startedAtMs: this.deps.clock.now().getTime(),
      freshTelemetry: true,
      ...(reopened ? { reopened: true } : {}),
      ...(lease !== null ? { lease } : {}),
    });
    this.deps.repo.add(run);
    await this.deps.streams.open(run, openingNotes(opening));
    const continuation = decision !== null && resumeRef !== null ? this.deps.sessions.continuationFor(id, request, resumeRef) : null;
    if (continuation !== null) {
      await this.deps.streams.say(run, 'brief: continuation — the resumed session already holds the full brief, only what changed rides');
    }
    // req-75: an interactive dialog starts QUIET — the worker spawns without its brief; the first owner send wraps it once.
    if (request.interactive !== undefined && !reopened) {
      run.info = { ...run.info, quietStart: true };
    }
    const handle = this.deps.launcher.launch(run, {
      resumeRef,
      ...(continuation !== null ? { instruction: continuation } : {}),
      ...(decision?.compactFirst === true ? { compactFirst: true } : {}),
      fallbackOnFailure: decision !== null && resumeRef !== null,
    });
    run.info = this.deps.machine.transition({ ...run.info, pid: handle.pid }, { kind: 'spawned' });
    return this.hold(run, reopened);
  }

  /**
   * req-65: an interactive dialog is the owner's from turn one — held at
   * spawn, and at its end neither the gate nor a move runs. A reopened
   * session stands held until the owner prompts it.
   */
  private async hold(run: LiveRun, reopened: boolean): Promise<StartOutcome> {
    const interactive = run.request.interactive;
    if (interactive !== undefined || reopened) {
      run.handle?.setHold?.(true);
      run.info = { ...run.info, held: true, ...(interactive !== undefined ? { interactive } : {}) };
    }
    await this.deps.repo.persist(run);
    if (reopened) {
      await this.deps.bookkeeper.note(run, 'session reopened by the owner — the worker stands until you prompt it');
    } else if (interactive !== undefined) {
      await this.deps.bookkeeper.note(run, `interactive dialog (${interactive}) — the worker waits for your first message; the run never gates or moves`);
    }
    return { ok: true, run: run.info };
  }
}
