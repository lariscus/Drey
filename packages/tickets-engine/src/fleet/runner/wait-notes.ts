/**
 * The chain log's "why nothing moves" (M85): a per-ticket note is logged
 * once — a later pass with the same reason is silent, a changed reason logs
 * again. A pass every 15 s must not repeat itself into the log.
 */
export class WaitNotes {
  /** Skip/wait lines already logged, ticket → line. */
  private readonly notes = new Map<string, string>();
  /** Tickets noted during the current pass — the sweep keeps only these. */
  private notedThisPass = new Set<string>();

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
}
