import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import { shortGateLine } from '../runner/run-summary';
import { DEFAULT_MAX_RED, failureBackoffMs, RED_COOLDOWN_MS } from './breaker';
import type { ChainState } from './chain-state';
import { isQuotaError } from './pool-sizes';

/**
 * The circuit breaker per persona (req-257, the persona board concept §9):
 * a red gate counts against the PERSONA that ran — a red gate raises its streak and cools it down; past the
 * threshold the persona is held the way the owner's pause holds it (its
 * tickets wait, a live run finishes), with the trip's reason beside it.
 * Playing the persona again resets it. A green end resets the streak.
 * The per-ticket back-off is part of it.
 */
export class PersonaBreaker {
  constructor(
    private readonly state: ChainState,
    private readonly env: { readonly clock: Clock; readonly log: (message: string) => void; readonly persist: () => Promise<void> },
  ) {}

  /** A green end of the persona's run: its streak starts again. */
  green(persona: string): void {
    this.state.personaRedStreak[persona] = 0;
  }

  /** A failed run of `persona`: the ticket's back-off, the persona's streak, its trip at {@link DEFAULT_MAX_RED} red gates in a row. */
  async failed(info: RunInfo, persona: string, maxRed: number = DEFAULT_MAX_RED): Promise<void> {
    if (isQuotaError(info.lastError)) {
      return this.env.persist(); // a spent quota is the pool's pause, not the persona's fault
    }
    if (info.redBackTo === undefined) {
      // req-78: a red gate that sent the ticket back moved it on to another persona — nothing for the ticket to back off from.
      const count = (this.state.ticketFailures[info.ticketId]?.count ?? 0) + 1;
      this.state.ticketFailures[info.ticketId] = { count, until: new Date(this.env.clock.now().getTime() + failureBackoffMs(count)).toISOString() };
    }
    if (info.gateFailure === null) {
      return this.env.persist(); // no gate verdict: the ticket backs off, the persona is not to blame
    }
    const streak = (this.state.personaRedStreak[persona] ?? 0) + 1;
    this.state.personaRedStreak[persona] = streak;
    this.state.personaCooldownUntil[persona] = new Date(this.env.clock.now().getTime() + RED_COOLDOWN_MS).toISOString();
    if (streak >= maxRed) {
      const reason = `${streak} red gates in a row`;
      this.state.pausedPersonas.add(persona);
      this.state.personaTripped[persona] = { reason, at: this.env.clock.now().toISOString() };
      this.env.log(`circuit breaker tripped on persona "${persona}" — ${reason}; last gate: ${shortGateLine(info.gateFailure).slice(0, 200)}; the persona holds until it is played again`);
    } else {
      this.env.log(`red gate of persona "${persona}" (${streak}/${maxRed}) — the persona cools down`);
    }
    await this.env.persist();
  }

  /** True while the persona's breather after a red gate lasts. */
  coolingDown(persona: string): boolean {
    const until = this.state.personaCooldownUntil[persona];
    return until !== undefined && !Number.isNaN(Date.parse(until)) && this.env.clock.now().getTime() < Date.parse(until);
  }
}
