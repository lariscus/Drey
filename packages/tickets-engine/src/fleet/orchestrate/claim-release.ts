import { PHASE_PIN_KEY, placementOfPhase } from '../../core/lifecycle-stages';
import { costOf } from '../../core/model-prices';
import { renderStatusComment } from '../../core/status-comment';
import { appendVerlaufEntry, renderVerlaufLine, verlaufEntryOf } from '../../core/verlauf';
import { setDocumentField } from '../../store/document-fields';
import type { Clock } from '../ports/clock';
import type { RunLease } from '../run-lease';
import type { TerminalRunState } from '../run/run-state';
import { failureLine, usageSummary } from '../run/run-summary';
import type { LiveRun } from './live-run';
import type { StoreClaims } from './store-claims';
import type { TicketCopy } from './ticket-copy';

/** Inside the claim the line is written before the settle: the price-table estimate is the settle's own fallback, applied here. */
function effectiveCost(run: LiveRun): number | null {
  const { costUsd, endedAt, model, tokensIn, tokensOut } = run.info;
  return costUsd ?? (endedAt === null ? costOf(model ?? null, tokensIn, tokensOut) : null);
}

/**
 * Where a green move releases to: on a lifecycle store (req-265) the next column's stage, with the
 * write that pins the column inside the claim; on a store still on phase stages the phase id itself.
 */
function moveTarget(run: LiveRun, nextPhase: string): { readonly stage: string; readonly pin?: (text: string) => string } {
  if (run.request.dk?.lifecycle !== true) {
    return { stage: nextPhase };
  }
  const placement = placementOfPhase(nextPhase);
  return { stage: placement.stage, pin: (text) => setDocumentField(text, PHASE_PIN_KEY, placement.pin) ?? text };
}

export type WriteResult ={ readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The run's hand-back of its ticket (E14-5/5b): release IS the one door —
 * a green gate releases into the next stage, a park into the park stage (or
 * the ticket's own) with a comment, every other end back where the ticket
 * sat. The run's `## Verlauf` line goes in INSIDE the claim, one `dk put`
 * just before the release, so chapter and hand-back stay one story.
 */
export class ClaimRelease {
  constructor(
    private readonly claims: StoreClaims,
    private readonly copy: TicketCopy,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {}

  /** The release of a run that moved nothing (failed, stopped, done without a move, detached). */
  async atEnd(run: LiveRun, note: string): Promise<void> {
    const lease = this.claims.leaseOf(run);
    if (lease.released || lease.fenced || run.claimLost !== undefined) {
      lease.stopKeepAlive();
      return;
    }
    // E14-6: a failed run says so as a `failed:` status comment (the Needs-you grammar); the rest is detail.
    const failed = run.info.state === 'failed' ? renderStatusComment({ verb: 'failed', text: failureLine(run.info), detail: note }) : null;
    await this.verlaufInClaim(run, lease, run.info.state as TerminalRunState);
    const result = await lease.release(this.claims.stayPutStages(run.request, lease), failed ?? note);
    if (!result.ok) {
      this.log(`run ${run.info.id}: releasing ${run.request.ticketId} failed - ${result.error}${result.lost ? '' : ' (the claim stays until its lease ends)'}`);
    }
  }

  /**
   * Green gate with a next phase: the release IS the move. On a lifecycle store (req-265) the next
   * column rides as the pin in the in-claim write that carries the Verlauf line, then one release
   * into its stage (`active` for a working column); on a store still on phase stages the release
   * names the next phase.
   */
  async move(run: LiveRun, nextPhase: string): Promise<WriteResult> {
    const lease = run.lease;
    if (lease === undefined || lease.fenced) {
      return { ok: false, error: 'the claim on the ticket was lost - nothing is moved' };
    }
    const parkFor = run.request.parkFor;
    const narrative = `run ${run.info.id} done - gate green, moving to ${nextPhase}${parkFor === undefined ? '' : `; parked for ${parkFor} (manual step)`}${usageSummary(run.info)}`;
    const note = renderStatusComment({ verb: 'done', text: `handed over on ${run.currentPhase}`, detail: narrative }) ?? narrative;
    const target = moveTarget(run, nextPhase);
    if (!(await this.verlaufInClaim(run, lease, 'done', target.pin)) && target.pin !== undefined) {
      return { ok: false, error: `the next column ${nextPhase} could not be written inside the claim - nothing is moved` };
    }
    const result = await lease.release([target.stage], note);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    run.currentPhase = target.pin === undefined ? result.stage : nextPhase;
    return { ok: true };
  }

  /** Park = the park stage (when the store has one) + a comment; otherwise the ticket keeps its stage and gets the comment. */
  async park(run: LiveRun, comment: string): Promise<WriteResult> {
    const lease = run.lease;
    if (lease === undefined || lease.fenced) {
      return { ok: false, error: 'the claim on the ticket was lost - nothing is parked' };
    }
    await this.verlaufInClaim(run, lease, 'done');
    const stages = [run.request.dk!.parkStage, ...this.claims.stayPutStages(run.request, lease)];
    const result = await lease.release(stages, comment);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  /**
   * The run's one Verlauf line (concept §5.4): phase, persona, model, tokens,
   * cost (the effective number), duration and outcome. Null when the run
   * consumed nothing — a zero-token, zero-cost run writes no chapter.
   */
  verlaufLine(run: LiveRun, state: TerminalRunState): string | null {
    const { tokensIn, tokensOut } = run.info;
    const cost = effectiveCost(run);
    if (tokensIn === 0 && tokensOut === 0 && (cost === null || cost <= 0)) {
      return null;
    }
    return renderVerlaufLine(
      verlaufEntryOf({
        phase: run.currentPhase || run.info.phase || null,
        persona: run.info.persona ?? null,
        model: run.info.model ?? null,
        tokensIn,
        tokensOut,
        cost,
        startedAt: run.info.startedAt,
        endedAt: run.info.endedAt ?? this.clock.now().toISOString(),
        state,
      }),
    );
  }

  /**
   * The one in-claim write before the release: the Verlauf line once per run (a second call — park
   * after a failed move — finds it written) and `extra` (the move's column pin, req-265). Nothing to
   * write = no commit. False only when a change was due and the write failed.
   */
  private async verlaufInClaim(run: LiveRun, lease: RunLease, state: TerminalRunState, extra?: (text: string) => string): Promise<boolean> {
    await this.copy.sync(run);
    const line = run.verlaufWritten === true ? null : this.verlaufLine(run, state);
    run.verlaufWritten = true;
    if (line === null && extra === undefined) {
      return true;
    }
    let changed = false;
    const written = await lease.patchInClaim((text) => {
      const withLine = line === null ? text : appendVerlaufEntry(text, line);
      const next = extra === undefined ? withLine : extra(withLine);
      changed = next !== text;
      return next;
    });
    return written || !changed;
  }
}
