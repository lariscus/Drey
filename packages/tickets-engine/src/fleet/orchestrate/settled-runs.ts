import type { LedgerWrite } from '../../core/ledger';
import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import { DEFAULT_MAX_RED, type Breaker } from './breaker';
import type { ChainState } from './chain-state';
import type { PersonaBreaker } from './persona-breaker';
import type { PoolCapacity } from './pool-capacity';
import type { SupervisorDirectory } from './supervisor-directory';

/** req-257: a chain run's persona and the breaker that counts it. */
interface ChainPersona {
  readonly persona: string;
  readonly breaker: PersonaBreaker;
}

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
/** req-274: a chain run's position and the chain's length for its ledger line; nothing outside a chain. */
function positionOf(info: RunInfo): { readonly position?: number; readonly length?: number } {
  return info.chainPosition === undefined ? {} : { position: info.chainPosition.at, length: info.chainPosition.length };
}

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
    const chainPersona = this.chainPersonaOf(record.request.cursor !== undefined, info);
    if (info.state === 'done') {
      state.redStreak[column] = 0;
      chainPersona?.breaker.green(chainPersona.persona);
      delete state.ticketFailures[info.ticketId];
      delete state.ownerHold[info.ticketId];
      if ((info.blocked ?? null) !== null) {
        state.ownerHold[info.ticketId] = hold; // a blocked end: incomplete — the dispatcher would run into the same wall
      }
    }
    if (info.state === 'stopped' && !machineStopped) {
      state.ownerHold[info.ticketId] = hold; // the owner stopped it: the ticket stays put until they move or start it
    }
    await this.books(info, column, chainPersona);
  }

  /** req-257: the persona whose breaker a chain run counts against; null for a column run. */
  private chainPersonaOf(chained: boolean, info: RunInfo): ChainPersona | null {
    const breaker = this.deps.personaBreaker;
    const persona = info.persona ?? null;
    return chained && breaker !== undefined && persona !== null ? { persona, breaker } : null;
  }

  /** A failure to its breaker — the persona's for a chain run (req-257), else the column's; any other end persists. */
  private async books(info: RunInfo, column: string, chainPersona: ChainPersona | null): Promise<void> {
    if (info.state !== 'failed') {
      return this.deps.persist();
    }
    if (chainPersona !== null) {
      const maxRed = this.deps.state.phases.find((p) => p.id === column)?.maxRed ?? DEFAULT_MAX_RED;
      return chainPersona.breaker.failed(info, chainPersona.persona, maxRed);
    }
    return this.deps.breaker.failed(info, column);
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
        ...positionOf(info), // req-274: the chain position the run worked
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
