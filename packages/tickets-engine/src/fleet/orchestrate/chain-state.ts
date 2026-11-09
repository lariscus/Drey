import { AUTOPILOT_OFF, masterOf } from '../autopilot';
import type { PipelinePhase } from '../../contracts/tickets';
import type { AutopilotRecord, ChainConfig, ChainMaster, ChainStatus, ChainTrip, ColumnMode } from '../protocol';

/** Per ticket: consecutive failed runs and the instant the next attempt may start. */
export interface TicketFailure {
  readonly count: number;
  readonly until: string;
}

/** Per ticket: the owner stopped its run (or it ended blocked) — no auto-dispatch until it moves or is started again. */
export interface OwnerHold {
  readonly phase: string;
  readonly at: string;
}

/** `<root>/chain.json` (ADR-0077): the chain's control state; the tickets repo never sees it (ADR-0076). */
export interface ChainFile {
  readonly version: 1;
  readonly config: ChainConfig | null;
  /** Derived from `autopilot`, still written for tools that read the file (FLEET.md). */
  readonly master: ChainMaster;
  /** The owner's switch (req-95); absent in older files, then `master` stands in. */
  readonly autopilot?: AutopilotRecord;
  readonly columns: Record<string, ColumnMode>;
  readonly redStreak: Record<string, number>;
  readonly cooldownUntil: Record<string, string>;
  /** Per column: the day the token sum belongs to, and the sum itself. */
  readonly tokensDay: Record<string, string>;
  readonly tokensUsed: Record<string, number>;
  /** Per ticket: the ci check's next attempt (a failed check backs off). */
  readonly ciBackoff: Record<string, string>;
  /** Per column: the breaker's trip while it holds (absent in older files). */
  readonly tripped?: Record<string, ChainTrip>;
  /** Set by a runner retiring for a newer build: its successor keeps the master. */
  readonly handoverAt?: string;
  readonly ticketFailures?: Record<string, TicketFailure>;
  readonly ownerHold?: Record<string, OwnerHold>;
  /** The personas the owner paused (U4, concept §4.3): their tickets hold until played again. */
  readonly pausedPersonas?: string[];
  /** req-170: per ticket, the ledger cards (Needs-you blockers) the pool raised and has not resolved yet. */
  readonly ledgerCards?: Record<string, string[]>;
}

/**
 * The chain's control state in memory (M85, ADR-0077): the config, the
 * Autopilot, the per-column modes and the breaker's, budget's and ci's
 * bookkeeping, the per-ticket holds, the paused personas. One object the
 * chain's parts share; `ChainStateStore` writes it to `chain.json`.
 */
export class ChainState {
  config: ChainConfig | null = null;
  autopilot: AutopilotRecord = AUTOPILOT_OFF;
  readonly columns: Record<string, ColumnMode> = {};
  readonly redStreak: Record<string, number> = {};
  readonly cooldownUntil: Record<string, string> = {};
  readonly tokensDay: Record<string, string> = {};
  readonly tokensUsed: Record<string, number> = {};
  readonly tripped: Record<string, ChainTrip> = {};
  readonly ticketFailures: Record<string, TicketFailure> = {};
  readonly ownerHold: Record<string, OwnerHold> = {};
  readonly ciBackoff: Record<string, string> = {};
  readonly pausedPersonas = new Set<string>();
  /** req-170: per ticket, the open ledger cards' keys (`ledger-ticket`, `ledger-persona-ben`). */
  readonly ledgerCards: Record<string, string[]> = {};
  /** The pipeline of the last pass — the breaker's thresholds and the quality rungs read it (not persisted). */
  phases: readonly PipelinePhase[] = [];

  /** The master is derived, never set: On dispatches, Paused and Off halt gently. */
  get master(): ChainMaster {
    return masterOf(this.autopilot);
  }

  /** The column's mode; a column nobody switched plays. */
  modeOf(phaseId: string): ColumnMode {
    return this.columns[phaseId] ?? 'playing';
  }

  /** Drops the per-phase state of phases the pipeline no longer has; true when anything went. */
  prune(known: ReadonlySet<string>): boolean {
    let changed = false;
    for (const map of [this.columns, this.redStreak, this.cooldownUntil, this.tokensDay, this.tokensUsed, this.tripped] as Record<string, unknown>[]) {
      for (const key of Object.keys(map)) {
        if (!known.has(key)) {
          delete map[key];
          changed = true;
        }
      }
    }
    return changed;
  }

  /** The control state as the status route answers it (pool sizes and quota pauses come from the pools). */
  status(pools: Pick<ChainStatus, 'quotaPausedUntil' | 'poolSize'>): ChainStatus {
    return {
      configured: this.config !== null,
      master: this.master,
      autopilot: this.autopilot,
      columns: { ...this.columns },
      redStreak: { ...this.redStreak },
      cooldownUntil: { ...this.cooldownUntil },
      tripped: { ...this.tripped },
      quotaPausedUntil: pools.quotaPausedUntil,
      pausedPersonas: [...this.pausedPersonas].sort(),
      poolSize: pools.poolSize,
    };
  }

  file(handoverAt?: string): ChainFile {
    return {
      version: 1,
      config: this.config,
      master: this.master,
      autopilot: this.autopilot,
      columns: { ...this.columns },
      redStreak: { ...this.redStreak },
      cooldownUntil: { ...this.cooldownUntil },
      tokensDay: { ...this.tokensDay },
      tokensUsed: { ...this.tokensUsed },
      ciBackoff: { ...this.ciBackoff },
      tripped: { ...this.tripped },
      ticketFailures: { ...this.ticketFailures },
      ownerHold: { ...this.ownerHold },
      pausedPersonas: [...this.pausedPersonas].sort(),
      ledgerCards: Object.fromEntries(Object.entries(this.ledgerCards).map(([ticket, keys]) => [ticket, [...keys]])),
      ...(handoverAt !== undefined ? { handoverAt } : {}),
    };
  }
}
