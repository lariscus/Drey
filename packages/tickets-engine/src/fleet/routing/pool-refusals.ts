import type { FullLedger, QueueReason } from '../protocol';

/** Why the candidates did not fit, gathered by kind. */
export class Refusals {
  readonly lines: { reason: QueueReason; text: string }[] = [];
  ledger: FullLedger | null = null;

  add(reason: QueueReason, text: string): void {
    this.lines.push({ reason, text });
  }

  /** Capacity wins (it frees by itself), then a ledger, then the configuration. */
  worst(): QueueReason {
    const kinds = new Set(this.lines.map((line) => line.reason));
    return kinds.has('capacity') ? 'capacity' : kinds.has('ledger') ? 'ledger' : 'config';
  }
}
