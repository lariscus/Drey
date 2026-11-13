import { AUTOPILOT_OFF, masterOf } from '../autopilot';
import type { PipelinePhase } from '../../contracts/tickets';
import type { AutopilotRecord, ChainConfig, ChainMaster, ChainStatus, ChainTrip, ColumnMode } from '../protocol';
import type { TrancheRecord } from './tranche/tranche-record';

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

/**
 * Which tickets vault a chain file belongs to, and how this device reaches
 * it (req-173): the path is the file's key, the store and the git
 * executable are this machine's. Not configuration — the vault's keys live
 * in its `_meta/crew.md`.
 */
export type ChainVaultLocator = Pick<ChainConfig, 'ticketsVaultPath' | 'store' | 'git'>;

/** The locator of a chain config. */
export function locatorOf(config: ChainVaultLocator): ChainVaultLocator {
  return { ticketsVaultPath: config.ticketsVaultPath, ...(config.store !== undefined ? { store: config.store } : {}), git: config.git };
}

/**
 * `<root>/chains/<vault key>/chain.json` (ADR-0077, req-173): the chain's
 * runtime state for one tickets vault; the tickets repo never sees it
 * (ADR-0076). Runtime only: the Autopilot, the column states, the breaker,
 * the streaks — never configuration.
 */
export interface ChainFile {
  readonly version: 1;
  /** The vault this state belongs to (req-173); absent in files from before it. */
  readonly vault?: ChainVaultLocator;
  /** Written by runners before req-173 only: read by the key migration, never restored, never written. */
  readonly config?: ChainConfig | null;
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
  /** req-257: the persona breaker — consecutive red gates per persona on a chain board. */
  readonly personaRedStreak?: Record<string, number>;
  /** req-257: per persona, the instant it may start again after a red gate. */
  readonly personaCooldownUntil?: Record<string, string>;
  /** req-257: per persona, the breaker's trip while the persona is held (paused). */
  readonly personaTripped?: Record<string, ChainTrip>;
  /** req-170: per ticket, the ledger cards (Needs-you blockers) the pool raised and has not resolved yet. */
  readonly ledgerCards?: Record<string, string[]>;
  /** req-179: the current tranche's counters, facts and checkpoint; absent before the first release. */
  readonly tranche?: TrancheRecord;
}

/**
 * The chain's control state in memory (M85, ADR-0077): the config, the
 * Autopilot, the per-column modes and the breaker's, budget's and ci's
 * bookkeeping, the per-ticket holds, the paused personas. One object the
 * chain's parts share; `ChainStateStore` writes it to `chain.json`.
 */
export class ChainState {
  /** The resolved config the board last sent (req-173: held in memory, never persisted). */
  config: ChainConfig | null = null;
  /** The vault whose file this state is (req-173); null before the first config or a boot from a file. */
  vault: ChainVaultLocator | null = null;
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
  /** req-257: the persona breaker on a chain board (see {@link ChainFile}). */
  readonly personaRedStreak: Record<string, number> = {};
  readonly personaCooldownUntil: Record<string, string> = {};
  readonly personaTripped: Record<string, ChainTrip> = {};
  /** req-271: the tickets the last pass left waiting for their persona's own pool (ticket -> persona); never persisted. */
  readonly personaWaits: Record<string, string> = {};
  /** req-170: per ticket, the open ledger cards' keys (`ledger-ticket`, `ledger-persona-ben`). */
  readonly ledgerCards: Record<string, string[]> = {};
  /** req-179: the current tranche; null before the first release (the tranche parts own it). */
  tranche: TrancheRecord | null = null;
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
      personaRedStreak: { ...this.personaRedStreak },
      personaTripped: { ...this.personaTripped },
      personaWaits: { ...this.personaWaits },
      poolSize: pools.poolSize,
    };
  }

  /** Empties the state before another vault's file is loaded into it (req-173): nothing carries over. */
  reset(): void {
    this.config = null;
    this.vault = null;
    this.autopilot = AUTOPILOT_OFF;
    const maps = [this.columns, this.redStreak, this.cooldownUntil, this.tokensDay, this.tokensUsed, this.tripped, this.ticketFailures, this.ownerHold, this.ciBackoff, this.ledgerCards, this.personaRedStreak, this.personaCooldownUntil, this.personaTripped, this.personaWaits];
    for (const map of maps as Record<string, unknown>[]) {
      for (const key of Object.keys(map)) {
        delete map[key];
      }
    }
    this.pausedPersonas.clear();
    this.tranche = null;
  }

  file(handoverAt?: string): ChainFile {
    return {
      version: 1,
      ...(this.vault !== null ? { vault: this.vault } : {}),
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
      personaRedStreak: { ...this.personaRedStreak },
      personaCooldownUntil: { ...this.personaCooldownUntil },
      personaTripped: { ...this.personaTripped },
      ledgerCards: Object.fromEntries(Object.entries(this.ledgerCards).map(([ticket, keys]) => [ticket, [...keys]])),
      ...(this.tranche !== null ? { tranche: this.tranche } : {}),
      ...(handoverAt !== undefined ? { handoverAt } : {}),
    };
  }
}
