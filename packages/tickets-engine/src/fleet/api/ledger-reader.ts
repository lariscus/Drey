import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { LEDGER_FILE, parseLedger, type LedgerEvent } from '../../core/pipeline/ledger';

/**
 * The fleet ledgers of the tickets vaults the report names (req-274) — the
 * hold lines' source. The same plain-fs vault read the journal reader uses;
 * a vault without a ledger reads as no events.
 */
export class LedgerReader {
  async eventsOf(vaultPaths: readonly string[]): Promise<readonly LedgerEvent[]> {
    const events: LedgerEvent[] = [];
    for (const vault of new Set(vaultPaths)) {
      const text = await fsp.readFile(path.join(vault, LEDGER_FILE), 'utf8').catch(() => null);
      if (text !== null) {
        events.push(...parseLedger(text));
      }
    }
    return events;
  }
}
