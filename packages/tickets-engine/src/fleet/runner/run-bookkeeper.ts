import { renderStatusComment, slugStatusKey } from '../../core/pipeline/status-comment';
import type { Clock } from '../ports/clock';
import type { RunRequest } from '../protocol';
import type { TerminalRunState } from './run-state';
import { usageSummary } from './run-summary';
import type { ClaimRelease, RedBackWrite, SendBackWrite, WriteResult } from '../lease/claim-release';
import type { LiveRun } from './live-run';
import type { RunStreams } from './run-streams';
import type { TicketCopy } from './ticket-copy';
import type { WaitClaim } from '../lease/wait-claim';

/** The chain's door to a store ticket that no run holds (the orchestrator's writes). */
export interface ChainCardDoor {
  comment(id: string, text: string, actor: string): Promise<void>;
}

export interface RunBookkeeperParts {
  readonly streams: RunStreams;
  readonly release: ClaimRelease;
  readonly wait: WaitClaim;
  readonly copy: TicketCopy;
  readonly clock: Clock;
  /** The machine's identity on the chain's own writes (`agent@<host>`). */
  readonly actor: string;
  readonly log: (message: string) => void;
}

/**
 * The one ticket writer of the Crew runner (ADR-0096): every write to a
 * ticket, its status comments and the Verlauf line —
 * the supervisor's and the orchestrator's alike — goes through here, over
 * the `TicketStore` port (a run's claim) or the chain's store door (a free
 * ticket). The legacy file writer is gone (req-176): a run record from
 * before the cut-over has no store target and writes no ticket (D-42).
 */
export class RunBookkeeper {
  constructor(private readonly parts: RunBookkeeperParts) {}

  /** The runner's own line in the run's transcript (`detail: 'runner'`: drawn as a system note, never a tool call). */
  async note(run: LiveRun, what: string): Promise<void> {
    await this.parts.streams.say(run, what, 'runner');
  }

  /** The settle's one ticket write: the claim goes, with the release note and the Verlauf line inside it. */
  async releaseAtEnd(run: LiveRun, note: string | null): Promise<void> {
    if (run.request.dk !== undefined) {
      await this.parts.release.atEnd(run, note ?? `run ${run.info.state}${usageSummary(run.info)}`);
    }
  }

  /** req-257: the success transition of a chain run — the cursor's next position inside the claim, one release into `active`. */
  async advanceOnSuccess(run: LiveRun): Promise<WriteResult> {
    if (run.request.dk === undefined) {
      return this.predatesStore(run, 'moved');
    }
    return this.parts.release.advance(run);
  }

  /** req-257: a chain run's send-back — the cursor back (`x-sent-back`) or the ticket to the owner, inside the claim, one release. */
  async sendBack(run: LiveRun, back: SendBackWrite): Promise<WriteResult> {
    if (run.request.dk === undefined) {
      return this.predatesStore(run, 'moved');
    }
    return this.parts.release.sendBack(run, back);
  }

  /** req-78: a red gate's send-back — the cursor to the entry's `on-red` target, the return recorded, inside the claim, one release. */
  async redBack(run: LiveRun, back: RedBackWrite): Promise<WriteResult> {
    if (run.request.dk === undefined) {
      return this.predatesStore(run, 'moved');
    }
    return this.parts.release.redBack(run, back);
  }

  /** A blocked end (ADR-0077): the claim goes, the worker's words as the comment, the ticket stays put. */
  async parkBlocked(run: LiveRun, blocked: string): Promise<void> {
    if (run.request.dk === undefined) {
      return;
    }
    const first = (blocked.split('\n')[0] ?? '').slice(0, 200);
    const comment = renderStatusComment({
      verb: 'blocked',
      key: slugStatusKey(`run ${run.info.id}`),
      text: first,
      detail: `run ${run.info.id} is blocked:\n\n${blocked}`,
    });
    await this.parts.release.park(run, comment ?? blocked);
  }

  releaseForWait(run: LiveRun, text: string): Promise<void> {
    return this.parts.wait.release(run, text);
  }

  reclaimAfterWait(run: LiveRun, answer: string | null): Promise<WriteResult> {
    return this.parts.wait.reclaim(run, answer);
  }

  writeCopy(request: RunRequest, dir: string): Promise<void> {
    return this.parts.copy.write(request, dir);
  }

  /** The ticket as the store holds it, the worker's changes merged in first (gate, scout report). */
  syncedText(run: LiveRun): Promise<string | null> {
    return this.parts.copy.syncedText(run);
  }

  /** The run's end: its copy goes. The persona's lesson is the closing round's (req-169), never a per-run line. */
  async closeRun(run: LiveRun): Promise<void> {
    await this.parts.copy.drop(run);
  }

  verlaufLine(run: LiveRun, state: TerminalRunState): string | null {
    return this.parts.release.verlaufLine(run, state);
  }

  // --- the chain's writes to tickets no run holds ------------------------------------

  /** req-170: a full ledger's Needs-you card (a keyed `blocked:` comment), or its `resolved:` once the pool grants again. */
  async ledgerCard(door: ChainCardDoor, ticketId: string, card: { readonly key: string; readonly text: string | null }): Promise<void> {
    const comment = card.text === null ? renderStatusComment({ verb: 'resolved', key: card.key }) : renderStatusComment({ verb: 'blocked', key: card.key, text: card.text });
    if (comment !== null) {
      await door.comment(ticketId, comment, this.parts.actor);
    }
  }

  private predatesStore(run: LiveRun, what: string): WriteResult {
    this.parts.log(`run ${run.info.id}: ${run.request.ticketId} predates the store - nothing is ${what}`);
    return { ok: true };
  }
}
