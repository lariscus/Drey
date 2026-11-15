import { ACTIVE_STAGE } from '../../core/lifecycle-stages';
import { costOf } from '../../core/model-prices';
import type { ChainEntry } from '../../contracts/chain';
import { invalidationLine, type SendBackDecision } from '../../core/chain-cursor';
import { renderSendBack } from '../../core/chain-list';
import { redBackLine, type RedGateDecision } from '../../core/chain-red-gate';
import { renderStatusComment } from '../../core/status-comment';
import { advancedText, type AdvancedText } from '../advance-text';
import { appendVerlaufEntry, renderVerlaufLine, verlaufEntryOf } from '../../core/verlauf';
import { setDocumentField } from '../../store/document-fields';
import type { Clock } from '../ports/clock';
import type { RunLease } from '../run-lease';
import type { TerminalRunState } from '../run/run-state';
import { failureLine, usageSummary } from '../run/run-summary';
import type { LiveRun } from './live-run';
import type { StoreClaims } from './store-claims';
import type { TicketCopy } from './ticket-copy';

/** The store's extension field of the chain's cursor (req-266). */
const CURSOR_KEY = 'x-at';
/** The one send-back a ticket may use (req-266). */
const SENT_BACK_KEY = 'x-sent-back';
/** The ticket waits for the owner (E10-6; req-257: a question, a second send-back). */
const AWAITING_KEY = 'x-awaiting';
/** req-78: the position a red gate sent the ticket back from, and the loop's count. */
const RETURN_TO_KEY = 'x-return-to';
const RED_BACKS_KEY = 'x-red-backs';

/** The hand-on of a chain run's green end: where the cursor went (on, through, or back — req-78) and the plan's chain note. */
function advanceLine(cursor: { readonly at: number; readonly length: number }, done: AdvancedText | null): string {
  const next = done?.next ?? cursor.at + 1;
  const where =
    next > cursor.length
      ? `the chain is through (${cursor.length} of ${cursor.length})`
      : done?.returned === true
        ? `back to position ${next} of ${cursor.length}, whose red gate sent it here`
        : `position ${next} of ${cursor.length} next`;
  const chainNote = done?.chainNote ?? null;
  return `gate green at position ${cursor.at} of ${cursor.length}; ${where}${chainNote === null ? '' : `; ${chainNote}`}`;
}

/** Several header fields at once (null removes one); a document without front matter stays as it is. */
function setFields(text: string, fields: readonly (readonly [string, string | null])[]): string {
  return fields.reduce((doc, [key, value]) => setDocumentField(doc, key, value) ?? doc, text);
}

/** Inside the claim the line is written before the settle: the price-table estimate is the settle's own fallback, applied here. */
function effectiveCost(run: LiveRun): number | null {
  const { costUsd, endedAt, model, tokensIn, tokensOut } = run.info;
  return costUsd ?? (endedAt === null ? costOf(model ?? null, tokensIn, tokensOut) : null);
}

export type WriteResult ={ readonly ok: true } | { readonly ok: false; readonly error: string };

/** req-78: what a red gate's send-back writes — the decision, the chain for the line, the gate's short line. */
export interface RedBackWrite {
  readonly decision: Extract<RedGateDecision, { readonly kind: 'back' }>;
  readonly chain: readonly ChainEntry[];
  readonly gate: string;
}

/** req-257: what a run's send-back writes — the decision (moved or to the owner), the run's reason, the chain for the line. */
export interface SendBackWrite {
  readonly decision: Exclude<SendBackDecision, { readonly kind: 'refused' }>;
  readonly reason: string;
  readonly chain: readonly ChainEntry[];
}

/**
 * The run's hand-back of its ticket (E14-5/5b): release IS the one door —
 * a green gate releases into `active` with the cursor on, a park into the park stage (or
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
    const result = await lease.release(this.claims.stayPutStages(lease), failed ?? note);
    if (!result.ok) {
      this.log(`run ${run.info.id}: releasing ${run.request.ticketId} failed - ${result.error}${result.lost ? '' : ' (the claim stays until its lease ends)'}`);
    }
  }

  /**
   * req-257: a chain run's green end — the cursor's next position (`x-at`) rides the in-claim write
   * that carries the Verlauf line, then ONE release into `active` (the run cannot release into the
   * stage it holds, R-31: `running` is the claim's own stage). Past the last entry the cursor stands
   * one beyond it: the chain is through, and the engine moves the ticket to `done` (an agent may not
   * release into a terminal stage).
   */
  async advance(run: LiveRun): Promise<WriteResult> {
    const lease = run.lease;
    const cursor = run.request.cursor;
    if (lease === undefined || lease.fenced || cursor === undefined) {
      return { ok: false, error: 'the claim on the ticket was lost - the cursor is not moved' };
    }
    let advanced: AdvancedText | null = null;
    const written = await this.verlaufInClaim(run, lease, 'done', (text) => {
      advanced = advancedText(text, cursor); // req-257: the cursor on, and a plan run's ### Chain; req-78: or straight back
      return advanced.text;
    });
    if (!written) {
      return { ok: false, error: `the cursor could not be written inside the claim - nothing is handed on` };
    }
    const narrative = `run ${run.info.id} done - ${advanceLine(cursor, advanced as AdvancedText | null)}${usageSummary(run.info)}`;
    const note = renderStatusComment({ verb: 'done', text: `handed over at position ${cursor.at} of ${cursor.length}`, detail: narrative }) ?? narrative;
    const result = await lease.release([ACTIVE_STAGE], note);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  /**
   * req-257: a run's send-back inside the claim, then ONE release into `active`. Moved: the cursor
   * to the named position and `x-sent-back`, the invalidation line as the release's comment (the
   * status log). To the owner (a second send-back): `x-awaiting: you` and a `needs-decision` with
   * both send-backs — the ticket stands at You.
   */
  async sendBack(run: LiveRun, back: SendBackWrite): Promise<WriteResult> {
    const lease = run.lease;
    if (lease === undefined || lease.fenced) {
      return { ok: false, error: 'the claim on the ticket was lost - nothing is sent back' };
    }
    const { decision, reason, chain } = back;
    const from = run.request.cursor?.at ?? 1;
    // req-78: a send-back invalidates everything from its target on — a red gate's pending return goes with it.
    const patch =
      decision.kind === 'moved'
        ? (text: string): string => setFields(text, [[CURSOR_KEY, String(decision.at)], [SENT_BACK_KEY, renderSendBack(decision.sentBack)], [RETURN_TO_KEY, null]])
        : (text: string): string => setDocumentField(text, AWAITING_KEY, 'you') ?? text;
    const note =
      decision.kind === 'moved'
        ? invalidationLine(chain, decision.sentBack, reason)
        : (renderStatusComment({
            verb: 'needs-decision',
            key: 'second-send-back',
            text: `a second send-back from position ${from}: ${reason.trim() || 'no reason given'}`.slice(0, 200),
            detail: `The ticket was sent back once already (${renderSendBack(decision.earlier)}); one send-back per ticket — decide: Accept hands it on, Send back returns it.\n\nThis send-back: from position ${from} — ${reason.trim()}`,
          }) ?? reason);
    if (!(await this.verlaufInClaim(run, lease, 'done', patch))) {
      return { ok: false, error: 'the send-back could not be written inside the claim' };
    }
    const result = await lease.release([ACTIVE_STAGE], note);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  /**
   * req-78: a red gate that sends the ticket back (its entry's `on-red`) — inside the claim the cursor
   * goes to the target, `x-return-to` records the position that went red and `x-red-backs` the loop's
   * count; then ONE release into `active` with the line as its comment (the status log). The ticket's
   * one persona send-back (`x-sent-back`) is not touched.
   */
  async redBack(run: LiveRun, back: RedBackWrite): Promise<WriteResult> {
    const lease = run.lease;
    if (lease === undefined || lease.fenced) {
      return { ok: false, error: 'the claim on the ticket was lost - nothing is sent back' };
    }
    const { decision } = back;
    const patch = (text: string): string =>
      setFields(text, [
        [CURSOR_KEY, String(decision.to)],
        [RETURN_TO_KEY, String(decision.from)],
        [RED_BACKS_KEY, String(decision.redBacks)],
      ]);
    if (!(await this.verlaufInClaim(run, lease, 'failed', patch))) {
      return { ok: false, error: 'the red gate could not send the ticket back inside the claim' };
    }
    const result = await lease.release([ACTIVE_STAGE], redBackLine(back.chain, decision, back.gate));
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  /** Park = the park stage (when the store has one) + a comment; otherwise the ticket keeps its stage and gets the comment. */
  async park(run: LiveRun, comment: string): Promise<WriteResult> {
    const lease = run.lease;
    if (lease === undefined || lease.fenced) {
      return { ok: false, error: 'the claim on the ticket was lost - nothing is parked' };
    }
    await this.verlaufInClaim(run, lease, 'done');
    const stages = [run.request.dk!.parkStage, ...this.claims.stayPutStages(lease)];
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
   * after a failed hand-on — finds it written) and `extra` (the cursor's write). Nothing to
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
