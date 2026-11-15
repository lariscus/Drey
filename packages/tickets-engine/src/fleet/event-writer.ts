/**
 * The runner's E7 event writer (concept §3.3): appends to the fleet
 * ledger (`tickets/_meta/ledger.jsonl` in the meta vault). Every write is
 * fire-and-forget — the caller never awaits, a failure lands in the
 * runner's log and never throws, and NO git commit happens per line: the
 * file rides along with the next regular commit, which sweeps it into the
 * history like every other vault change. A per-writer promise mutex
 * serializes the read-modify-append so two events of one burst cannot
 * interleave. A ticket's status events are comments in the store (E14-6),
 * never a file of this writer.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { LEDGER_FILE, renderLedgerLine, type LedgerWrite } from '../core/ledger';

export interface FleetEventWriterDeps {
  /** The tickets vault root (the runner reads it directly). */
  readonly vaultPath: string;
  /** The runner's log — the only place a swallowed failure surfaces. */
  readonly log: (message: string) => void;
}

export class FleetEventWriter {
  /** The per-writer mutex tail: every op queues behind the previous one. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FleetEventWriterDeps) {}

  /** Appends one ledger line; the file may be absent (the first line starts it). */
  ledger(write: LedgerWrite): void {
    this.enqueue(async () => {
      const file = path.join(this.deps.vaultPath, LEDGER_FILE);
      const existing = await fsp.readFile(file, 'utf8').catch(() => null);
      // A torn tail (no trailing newline) would glue the new line onto it.
      const prefix = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.appendFile(file, `${prefix}${renderLedgerLine(new Date().toISOString(), write)}`, 'utf8');
    }, `ledger ${write.kind} ${write.ticket}`);
  }

  /** Fire-and-forget: failures log and swallow, never throw into the caller. */
  private enqueue(op: () => Promise<void>, what: string): void {
    this.tail = this.tail.then(op).catch((error: unknown) => {
      this.deps.log(`event writer: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
