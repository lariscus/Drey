import type { BoardSnapshot } from '../../contracts/tickets';
import type { ColumnMode } from '../protocol';
import { cardWait, type WaitContext } from './wait-lines';

/**
 * The chain log's "why nothing moves" (M85): a per-ticket note is logged
 * once — a later pass with the same reason is silent, a changed reason logs
 * again — and the held-column and budget lines on change only. A pass every
 * 15 s must not repeat itself into the log.
 */
export class WaitNotes {
  /** Skip/wait lines already logged, ticket → line. */
  private readonly notes = new Map<string, string>();
  /** Tickets noted during the current pass — the sweep keeps only these. */
  private notedThisPass = new Set<string>();
  private heldNote = '';
  private budgetNote = '';

  constructor(private readonly log: (message: string) => void) {}

  beginPass(): void {
    this.notedThisPass = new Set();
  }

  /** Forgets the notes of tickets the pass did not note again: their reason is gone. */
  endPass(): void {
    for (const ticket of [...this.notes.keys()]) {
      if (!this.notedThisPass.has(ticket)) {
        this.notes.delete(ticket);
      }
    }
  }

  skip(ticketId: string, line: string): void {
    this.notedThisPass.add(ticketId);
    if (this.notes.get(ticketId) !== line) {
      this.notes.set(ticketId, line);
      this.log(line);
    }
  }

  /** A dispatched ticket's earlier wait is over. */
  clear(ticketId: string): void {
    this.notes.delete(ticketId);
  }

  budget(line: string): void {
    if (this.budgetNote !== line) {
      this.budgetNote = line;
      this.log(line);
    }
  }

  /** The silent cases the plan leaves behind, per card, plus one line for every candidate in a held column. */
  waits(snap: BoardSnapshot, modeOf: (phaseId: string) => ColumnMode, ctx: WaitContext): void {
    const held: string[] = [];
    for (const column of snap.columns) {
      const mode = modeOf(column.phase.id);
      for (const card of column.tickets) {
        const wait = cardWait(card, column, mode, ctx);
        for (const line of wait.lines) {
          this.skip(card.id, line);
        }
        if (wait.held) {
          held.push(card.id);
        }
      }
    }
    const heldLine = held.length > 0 ? `${held.join(', ')} ${held.length === 1 ? 'waits' : 'wait'} in a held column — switch the column to playing or move the ticket` : '';
    if (heldLine !== this.heldNote) {
      this.heldNote = heldLine;
      if (heldLine !== '') {
        this.log(heldLine);
      }
    }
  }
}
