import type { TicketHolder } from '../../core/pipeline/chain-holder';
import type { HoldMark } from './chain-state';
import type { FleetLedger } from '../runner/settled-runs';

/** What the recorder keeps between passes: the last recorded hold per held ticket (`chain.json`). */
export interface HoldBook {
  readonly holds: Record<string, HoldMark>;
}

export interface HoldRecorderDeps {
  readonly book: HoldBook;
  readonly events?: FleetLedger;
  readonly persist: () => Promise<void>;
}

/** The hold a holder stands for; null in a lifecycle column (no holder). */
export function holdMarkOf(holder: TicketHolder): HoldMark | null {
  if (holder.kind === 'none') {
    return null;
  }
  return { persona: holder.persona, position: holder.entry?.position ?? null, length: holder.entry?.length ?? null };
}

function sameHold(a: HoldMark | undefined, b: HoldMark | null): boolean {
  return a !== undefined && b !== null && a.persona === b.persona && a.position === b.position && a.length === b.length;
}

/**
 * The cursor's moves as `hold` ledger lines (req-274, the persona board
 * concept §10). Each dispatch pass on a lifecycle store hands it every
 * ticket's derived holder; a ticket whose holder or chain position differs
 * from the last recorded hold gets one line — the new holder and position,
 * or a closing line without a persona when it left the chain (a lifecycle
 * column) or the board. It observes instead of hooking every writer of the
 * cursor, so a run's hand-on, an owner's drag, a send-back and a hand edit
 * of `x-at` are recorded alike, at the pass that first sees them. The last
 * hold per ticket lives in `chain.json`: a restarted runner writes nothing
 * for a hold it already recorded.
 */
export class HoldRecorder {
  constructor(private readonly deps: HoldRecorderDeps) {}

  async observe(holders: ReadonlyMap<string, TicketHolder>): Promise<void> {
    const book = this.deps.book.holds;
    let changed = false;
    for (const [ticket, holder] of holders) {
      changed = this.record(ticket, holdMarkOf(holder)) || changed;
    }
    for (const ticket of Object.keys(book).filter((id) => !holders.has(id))) {
      changed = this.record(ticket, null) || changed; // the ticket left the board (archived, deleted)
    }
    if (changed) {
      await this.deps.persist();
    }
  }

  /** One ticket's hold against the book; true when a line was written. */
  private record(ticket: string, mark: HoldMark | null): boolean {
    const book = this.deps.book.holds;
    const last = book[ticket];
    if ((last === undefined && mark === null) || sameHold(last, mark)) {
      return false;
    }
    this.deps.events?.ledger(mark === null ? { kind: 'hold', ticket } : { kind: 'hold', ticket, persona: mark.persona, position: mark.position, length: mark.length });
    if (mark === null) {
      delete book[ticket];
    } else {
      book[ticket] = mark;
    }
    return true;
  }
}
