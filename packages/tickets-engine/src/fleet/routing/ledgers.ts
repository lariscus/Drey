import type { FullLedger, LedgerFigure, RunLedgerInput } from '../protocol';
import type { Clock } from '../ports/clock';
import type { PoolSettingsView } from './pool-settings';

/** What a ledger reads of a session record (run telemetry, ADR-0081): every figure is a sum of these. */
export interface SessionCost {
  readonly ticketId: string;
  readonly persona?: string | null;
  readonly costUsd: number | null;
  readonly startedAt: string;
  readonly slot?: { readonly id: string } | undefined;
}

/** The session records the ledgers sum over. */
export interface SessionRecords {
  all(): readonly SessionCost[];
}

/** Who a start spends for. */
export interface LedgerSubject {
  readonly ticket: string;
  readonly persona: string | null;
  readonly input: RunLedgerInput;
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

/**
 * The three ledgers (req-170, ADR-0095): the ticket's allowance, the
 * persona's day and the provider's day (a slot — an account — per day).
 * Counting happens on the session records only; a ledger is a sum over
 * them, never a counter of its own. A day is the UTC date a session started.
 */
export class Ledgers {
  constructor(
    private readonly records: SessionRecords,
    private readonly settings: PoolSettingsView,
    private readonly clock: Clock,
  ) {}

  /** The ticket's allowance and the persona's day; null while both have room. */
  fullFor(subject: LedgerSubject): FullLedger | null {
    const ticketLimit = subject.input.allowance ?? this.settings.ledgers().ticketAllowance;
    const ticketSpent = this.sum((r) => r.ticketId === subject.ticket);
    if (ticketLimit !== null && ticketSpent >= ticketLimit && !subject.input.spendAboveAllowance) {
      return { ledger: 'ticket', key: 'ledger-ticket', spent: ticketSpent, limit: ticketLimit, line: `${subject.ticket} has spent ${usd(ticketSpent)} of its ${usd(ticketLimit)} allowance` };
    }
    if (subject.persona === null) {
      return null;
    }
    const personaLimit = subject.input.personaBudget ?? this.settings.ledgers().personaPerDay;
    const personaSpent = this.sum((r) => r.persona === subject.persona && this.today(r));
    return personaLimit !== null && personaSpent >= personaLimit
      ? { ledger: 'persona', key: `ledger-persona-${subject.persona}`, spent: personaSpent, limit: personaLimit, line: `${subject.persona} has spent ${usd(personaSpent)} of ${usd(personaLimit)} today` }
      : null;
  }

  /** The slot's day; null while it has room. */
  fullOn(slot: { readonly id: string; readonly label: string }): FullLedger | null {
    const limit = this.settings.ledgers().providerPerDay;
    const spent = this.spentToday(slot.id);
    return limit !== null && spent >= limit
      ? { ledger: 'provider', key: `ledger-provider-${slot.id}`, spent, limit, line: `${slot.label} has spent ${usd(spent)} of ${usd(limit)} today` }
      : null;
  }

  /** Today's spend per slot against the provider ledger. */
  providerDay(slotIds: readonly string[]): LedgerFigure[] {
    const limit = this.settings.ledgers().providerPerDay;
    return slotIds.map((id) => ({ id, spent: Math.round(this.spentToday(id) * 100) / 100, limit }));
  }

  private spentToday(slotId: string): number {
    return this.sum((r) => r.slot?.id === slotId && this.today(r));
  }

  private today(record: SessionCost): boolean {
    return record.startedAt.slice(0, 10) === this.clock.now().toISOString().slice(0, 10);
  }

  private sum(match: (record: SessionCost) => boolean): number {
    return this.records
      .all()
      .filter(match)
      .reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  }
}
