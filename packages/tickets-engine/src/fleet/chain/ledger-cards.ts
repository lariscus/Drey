import type { ChainConfig, FullLedger } from '../protocol';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import { messageOf } from '../runner/live-run';
import type { RunBookkeeper } from '../runner/run-bookkeeper';

export interface LedgerCardsDeps {
  readonly state: ChainState;
  readonly board: Pick<ChainBoard, 'door'>;
  readonly bookkeeper: Pick<RunBookkeeper, 'ledgerCard'>;
  readonly persist: () => Promise<void>;
  readonly log: (message: string) => void;
}

const WHAT_NOW: Readonly<Record<FullLedger['ledger'], string>> = {
  ticket: "raise the ticket's allowance: or let the persona spend above it (allowed: spend-above-allowance)",
  persona: "raise the persona's budget: or wait for tomorrow",
  provider: 'raise Provider per day in Settings → Models or wait for tomorrow',
};

/**
 * The Needs-you card of a full ledger (req-170, ADR-0095): the pool grants
 * no slot, so the ticket gets one keyed `blocked:` status comment (the
 * Needs-you list reads open blockers) — once per ledger, not every pass —
 * and its `resolved:` when the pool grants it again. The open cards live in
 * `chain.json`, so a restarted runner still closes what it raised.
 */
export class LedgerCards {
  constructor(private readonly deps: LedgerCardsDeps) {}

  async raise(config: ChainConfig, ticketId: string, ledger: FullLedger): Promise<void> {
    const open = this.deps.state.ledgerCards[ticketId] ?? [];
    if (open.includes(ledger.key)) {
      return;
    }
    const written = await this.write(config, ticketId, { key: ledger.key, text: `${ledger.line} — ${WHAT_NOW[ledger.ledger]}` });
    if (written) {
      this.deps.state.ledgerCards[ticketId] = [...open, ledger.key];
      this.deps.log(`${ticketId} waits on a full ledger: ${ledger.line} — a Needs-you card says so`);
      await this.deps.persist();
    }
  }

  /** The pool granted the ticket: every card it raised there is resolved. */
  async resolve(config: ChainConfig, ticketId: string): Promise<void> {
    const open = this.deps.state.ledgerCards[ticketId] ?? [];
    if (open.length === 0) {
      return;
    }
    for (const key of open) {
      await this.write(config, ticketId, { key, text: null });
    }
    delete this.deps.state.ledgerCards[ticketId];
    await this.deps.persist();
  }

  private async write(config: ChainConfig, ticketId: string, card: { key: string; text: string | null }): Promise<boolean> {
    const door = this.deps.board.door(config);
    if (door === null) {
      return false;
    }
    try {
      await this.deps.bookkeeper.ledgerCard(door, ticketId, card);
      return true;
    } catch (error) {
      this.deps.log(`the ledger card of ${ticketId} could not be written: ${messageOf(error)}`);
      return false;
    }
  }
}
