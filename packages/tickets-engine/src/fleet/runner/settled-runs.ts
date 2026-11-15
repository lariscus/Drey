import type { LedgerWrite } from '../../core/pipeline/ledger';
import type { Clock } from '../ports/clock';
import type { RunInfo } from '../protocol';
import type { ChainState } from '../chain/chain-state';
import type { PersonaBreaker } from '../chain/persona-breaker';
import type { PoolCapacity } from '../chain/pool-capacity';
import type { SupervisorDirectory } from './supervisor-directory';

/** The E7 event sink (concept §3.3): fire-and-forget, a failure never reaches the loop. */
export interface FleetLedger {
  readonly ledger: (write: LedgerWrite) => void;
}

export interface SettledRunsDeps {
  readonly state: ChainState;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
  /** req-257: a run's red gate counts against its persona. */
  readonly personaBreaker: PersonaBreaker;
  readonly clock: Clock;
  readonly persist: () => Promise<void>;
  readonly events?: FleetLedger;
}

/**
 * A run settled (M85): one ledger line per run that consumed anything, the
 * pool's reading of a quota or rate-limit error, and — for a dispatched run
 * — the holds a stop or a blocked end leaves, and the persona's breaker on a
 * failure. The status comment of the end is
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
    const machineStopped = this.deps.directory.takeMachineStop(info.id);
    const state = this.deps.state;
    const hold = { phase: record.request.phase, at: this.deps.clock.now().toISOString() };
    const persona = info.persona ?? null;
    if (info.state === 'done') {
      if (persona !== null) {
        this.deps.personaBreaker.green(persona);
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
    await this.books(info, persona);
  }

  /** A failure to the persona's breaker (req-257); a run with no persona has none to blame; any other end persists. */
  private async books(info: RunInfo, persona: string | null): Promise<void> {
    if (info.state !== 'failed' || persona === null) {
      return this.deps.persist();
    }
    return this.deps.personaBreaker.failed(info, persona);
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
}
