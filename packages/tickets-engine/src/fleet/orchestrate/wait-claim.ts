import { renderStatusComment, slugStatusKey } from '../../core/status-comment';
import { setDocumentField } from '../../store/document-fields';
import type { WriteResult } from './claim-release';
import { messageOf, type LiveRun } from './live-run';
import type { StoreClaims } from './store-claims';
import type { TicketCopy } from './ticket-copy';

/**
 * Q-03 (accepted 2026-11-05): a run that waits for the owner may wait for
 * days, but dk's lease is bounded (max lease, 3 extensions) — so the claim
 * is GIVEN UP for the wait and taken again on the answer (a new epoch). The
 * ticket carries the question as a `needs-decision:` comment and goes to
 * the store's `needs-input` stage when it has one, else stays unclaimed
 * where it is. Not done when commit trailers are on (the epoch they carry
 * must stay) or for the owner's own dialog (nothing waits there).
 */
/** Whether the run's claim may be given up for a wait: no trailers, no dialog, held and not yet given up. */
function releasable(run: LiveRun): boolean {
  const lease = run.lease;
  if (run.request.dk?.trailers === true || run.request.interactive !== undefined || lease === undefined) {
    return false;
  }
  return run.waitReleased !== true && !lease.released && !lease.fenced && run.claimLost === undefined;
}

/** The ticket waits for the owner (req-257: a chain run's question puts the card at You). */
const AWAITING_KEY = 'x-awaiting';

export class WaitClaim {
  constructor(
    private readonly claims: StoreClaims,
    private readonly copy: TicketCopy,
    private readonly log: (message: string) => void,
  ) {}

  async release(run: LiveRun, text: string): Promise<void> {
    const target = run.request.dk;
    const lease = run.lease;
    if (target === undefined || lease === undefined || !releasable(run)) {
      return;
    }
    await this.copy.sync(run);
    if (run.request.cursor !== undefined) {
      // req-257: a question in a chain run moves the card to You (the holder rule's `awaiting`); the answer brings it back.
      await lease.patchInClaim((text) => setDocumentField(text, AWAITING_KEY, 'you') ?? text);
    }
    const key = slugStatusKey(`run ${run.info.id} waits`) ?? undefined;
    const note = renderStatusComment({
      verb: 'needs-decision',
      ...(key === undefined ? {} : { key }),
      text: (text.split('\n')[0] ?? '').slice(0, 200) || 'waits for the owner',
      detail: `run ${run.info.id} waits for the owner:\n\n${text}`,
    });
    const result = await lease.release([target.needsInputStage ?? null, ...this.claims.stayPutStages(run.request, lease)], note);
    if (!result.ok) {
      this.log(`run ${run.info.id}: giving up the claim for the wait failed - ${result.error} (the lease keeps running)`);
      return;
    }
    run.waitReleased = true;
    if (key !== undefined) {
      run.waitKey = key;
    }
    this.log(`run ${run.info.id}: ${run.request.ticketId} released to ${result.stage} for the wait; the answer re-claims it`);
  }

  /** The owner answered: take the ticket up again (a new epoch) before the worker goes on; ok when nothing was released. */
  async reclaim(run: LiveRun, answer: string | null): Promise<WriteResult> {
    const lease = run.lease;
    if (run.waitReleased !== true || lease === undefined) {
      return { ok: true };
    }
    try {
      await lease.reclaim();
    } catch (error) {
      // Someone else holds the ticket now: the worker must not go on writing for a ticket that is not ours.
      return { ok: false, error: `${run.request.ticketId} could not be re-claimed for the answer - ${messageOf(error)}` };
    }
    run.waitReleased = false;
    if (run.request.cursor !== undefined) {
      await lease.patchInClaim((text) => setDocumentField(text, AWAITING_KEY, null) ?? text); // req-257: back to the persona that asked
    }
    const key = run.waitKey;
    if (key !== undefined) {
      const resolved = renderStatusComment({ verb: 'resolved', key, ...(answer === null ? {} : { detail: answer }) });
      if (resolved !== null) {
        await lease.comment(resolved);
      }
    }
    return { ok: true };
  }
}
