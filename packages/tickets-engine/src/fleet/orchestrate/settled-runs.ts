import type { LedgerWrite } from '../../core/ledger';
import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import { DEFAULT_MAX_RED, type Breaker } from './breaker';
import type { ChainState } from './chain-state';
import type { PersonaBreaker } from './persona-breaker';
import type { PoolCapacity } from './pool-capacity';
import type { SupervisorDirectory } from './supervisor-directory';

/** The E7 event sink (concept §3.3): fire-and-forget, a failure never reaches the loop. */
export interface FleetLedger {
  readonly ledger: (write: LedgerWrite) => void;
}

export interface SettledRunsDeps {
  readonly state: ChainState;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
  readonly breaker: Breaker;
  /** req-257: a chain run's red gate counts against its persona; absent = every run counts per column. */
  readonly personaBreaker?: PersonaBreaker;
  readonly clock: Clock;
  readonly persist: () => Promise<void>;
  readonly events?: FleetLedger;
}

/**
 * A run settled (M85): one ledger line per run that consumed anything, the
 * pool's reading of a quota or rate-limit error, and — for a dispatched run
 * — the column's books: the day's tokens, the holds a stop or a blocked end
 * leaves, and the breaker on a failure. The status comment of the end is
 * the run's own release (E14-6), never a second line here.
 */
export class SettledRuns {
  constructor(private readonly deps: SettledRunsDeps) {}

  async onSettled(info: RunInfo): Promise<void> {
    this.ledger(info);
    this.deps.pools.noteFailure(info);
    const record = this.deps.directory.find(info.id);
    const column = record?.request.column ?? null;
    if (record === null || column === null) {
      return;
    }
    this.countTokens(info, column);
    const machineStopped = this.deps.directory.takeMachineStop(info.id);
    const state = this.deps.state;
    const hold = { phase: record.request.phase, at: this.deps.clock.now().toISOString() };
    const chainPersona = record.request.cursor !== undefined && this.deps.personaBreaker !== undefined ? (info.persona ?? null) : null;
    if (info.state === 'done') {
      state.redStreak[column] = 0;
      if (chainPersona !== null) {
        this.deps.personaBreaker!.green(chainPersona);
      }
      delete state.ticketFailures[info.ticketId];
      delete state.ownerHold[info.ticketId];
      if ((info.blocked ?? null) !== null) {
        state.ownerHold[info.ticketId] = hold; // a blocked end: incomplete — the dispatcher would run into the same wall
      }
    }
    if (info.state === 'stopped' && !machineStopped) {
      state.ownerHold[info.ticketId] = hold; // the owner stopped it: the ticket stays put until they move or start it
    }
    if (info.state === 'failed' && chainPersona !== null) {
      const maxRed = state.phases.find((p) => p.id === column)?.maxRed ?? DEFAULT_MAX_RED;
      return this.deps.personaBreaker!.failed(info, chainPersona, maxRed);
    }
    await (info.state === 'failed' ? this.deps.breaker.failed(info, column) : this.deps.persist());
  }

  /** Costtracking (concept §4.3): what a completed run effectively consumed; an empty run writes nothing. */
  private ledger(info: RunInfo): void {
    const cost = info.costUsd;
    if (info.tokensIn > 0 || info.tokensOut > 0 || (cost !== null && cost > 0)) {
      this.deps.events?.ledger({
        kind: 'run_settled',
        ticket: info.ticketId,
        persona: info.persona ?? null,
        model: info.model ?? null,
        tokensIn: info.tokensIn,
        tokensOut: info.tokensOut,
        cost: cost !== null && cost > 0 ? cost : null,
      });
    }
  }

  private countTokens(info: RunInfo, column: string): void {
    const tokens = info.tokensIn + info.tokensOut;
    if (tokens <= 0) {
      return;
    }
    const day = this.deps.clock.now().toISOString().slice(0, 10);
    if (this.deps.state.tokensDay[column] !== day) {
      this.deps.state.tokensDay[column] = day;
      this.deps.state.tokensUsed[column] = 0;
    }
    this.deps.state.tokensUsed[column] = (this.deps.state.tokensUsed[column] ?? 0) + tokens;
  }
}
