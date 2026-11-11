import type { FleetCaps, FleetHandoverConfig, FleetPools } from './protocol-fleet-config';
import type { PermissionMode } from './protocol';
import type { PoolLoad, QueueEntry } from './protocol-pool';
import type { BurnRateBasis } from './protocol-routing';
import type { SlotSummary } from './protocol-slots';
import type { TrancheConfig, TrancheStatus } from './protocol-tranche';

// ---------------------------------------------------------------------------
// The chain (M85, ADR-0077): the orchestrator's configuration and control
// state. Config rides from the plugin (which owns the plugin config and
// the vault registry); master and per-column state persist runner-side in
// `<root>/chain.json` — never in the tickets repo (ADR-0076: no view
// state in the repo).

/** The master switch: `run` dispatches, `halted` lets running work finish. */
export type ChainMaster = 'run' | 'halted';

/** The Autopilot (req-95, concept §6.1): the owner's switch the master is derived from. */
export type AutopilotState = 'on' | 'paused' | 'off';

/** Why the Autopilot is Paused when the runner paused it itself (req-179: a tranche ended or stopped early). */
export type AutopilotReason = 'checkpoint';

/** What `chain.json` and the chain status carry; `resumeAt` (ISO) and `reason` only ever on `paused`. */
export interface AutopilotRecord {
  readonly state: AutopilotState;
  readonly resumeAt?: string;
  readonly reason?: AutopilotReason;
}

/** A refused Autopilot write or stop-now: the code is what a client maps to its catalog. */
export interface AutopilotRefusal {
  readonly ok: false;
  readonly error: string;
  readonly code: 'bad_state' | 'bad_resume_at' | 'runner_down' | 'read_only';
}

/** One column's brake: `playing` dispatches, `held` waits (a stop also holds). */
export type ColumnMode = 'playing' | 'held';

/** What the plugin tells the runner about its world (idempotent POST). */
/**
 * Where the chain finds its tickets when the board runs on dricket (E14-5b, ADR-0090): the same
 * settings the board reads, handed to the runner process. The tickets are read from the checkout's
 * files and written only through `dk`; `ticketsVaultPath` stays the META vault (pipeline, repos,
 * personas, prompts, worktrees).
 */
export interface ChainStoreConfig {
  /** `dk` executable; empty = `dk` on PATH. */
  readonly dkPath: string;
  readonly dkStore: string;
  readonly dkDataDir: string;
  /** The checkout the board is read from (`tickets.dk.checkout`); empty = the local store itself. */
  readonly dkCheckout: string;
  /** Commit trailers + `dk validate --trailers` in the gate (`tickets.dk.trailers`). */
  readonly trailers: boolean;
  /**
   * req-265: the store is on the lifecycle stages (`inbox prioritized active running done`, claim
   * `running`): a column is `active` + the pin `x-phase`, a run ends with one release into `active`.
   * Absent or false = a store still on phase stages (stage = column id).
   */
  readonly lifecycle?: boolean;
}

export interface ChainConfig {
  /** Absolute path of the tickets vault to orchestrate (on dricket: the meta vault). */
  readonly ticketsVaultPath: string;
  /** E14-5b: set while `tickets.backend = dricket`: the tickets come from this store, not from ticket files. */
  readonly store?: ChainStoreConfig;
  /** Git executable for ticket commits (the plugin's gitPath or `git`). */
  readonly git: string;
  /** The plugin's configured default worker (the assignment ring's floor). */
  readonly defaultWorker: string;
  /** The engine's default persona (config `personas.default`, ADR-0088 E3); absent pre-personas. */
  readonly defaultPersona?: string | null;
  /** Permission mode of dispatched runs (no dialog to ask in). */
  readonly permissionMode: PermissionMode;
  /** The instruction output caps (T-0048); absent = `DEFAULT_FLEET_CAPS`. */
  readonly caps?: FleetCaps;
  /** The per-provider pools (req-63); absent = one run per provider. */
  readonly pools?: FleetPools;
  /** The handover thresholds (T-0049); absent = `DEFAULT_FLEET_HANDOVER`. */
  readonly handover?: FleetHandoverConfig;
  /** req-179: the tranche size and the early-stop thresholds; absent = `DEFAULT_TRANCHE`. */
  readonly tranche?: TrancheConfig;
}

/** The store settings of a request body (the chain config, the release-leftovers action); null when it names no store. */
export function normalizeChainStore(value: unknown): ChainStoreConfig | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  const text = (...keys: string[]): string => {
    for (const key of keys) {
      if (typeof v[key] === 'string') {
        return (v[key] as string).trim();
      }
    }
    return '';
  };
  const dkStore = text('dkStore', 'store');
  if (dkStore === '') {
    return null;
  }
  return {
    dkPath: text('dkPath', 'bin'),
    dkStore,
    dkDataDir: text('dkDataDir', 'dataDir'),
    dkCheckout: text('dkCheckout', 'checkout'),
    trailers: v['trailers'] === true,
  };
}

/** The chain's control state as the runner reports it. */
export interface ChainStatus {
  /** True once a chain config is set (the board shows the master switch). */
  readonly configured: boolean;
  readonly master: ChainMaster;
  /** The Autopilot record `master` derives from; absent on older runners (`autopilotOf` reads through). */
  readonly autopilot?: AutopilotRecord;
  /** Per working column mode; a phase absent here is `playing`. */
  readonly columns: Readonly<Record<string, ColumnMode>>;
  /** Consecutive red gates per column (the circuit breaker's counter). */
  readonly redStreak: Readonly<Record<string, number>>;
  /** Columns in cooldown — the ISO instant dispatching resumes after a red gate. */
  readonly cooldownUntil: Readonly<Record<string, string>>;
  /**
   * Columns the circuit breaker holds: why and since when. Cleared when
   * the owner plays the column again. Absent on runners before the
   * chain alerts fix — the board then reads a hold with a full red
   * streak as a trip.
   */
  readonly tripped?: Readonly<Record<string, ChainTrip>>;
  /** Per provider: its quota is spent, no new run before this ISO instant (absent on older runners). */
  readonly quotaPausedUntil?: Readonly<Record<string, string>>;
  /**
   * The personas the owner paused (U4, concept §4.3): the dispatcher
   * holds their tickets until each is played again. Absent on runners
   * before the persona pause existed — readers treat that as none.
   */
  readonly pausedPersonas?: readonly string[];
  /**
   * Per provider: the effective parallel runs its pool carries right now
   * (configured size, capped by a probe, minus a rate-limit shrink) — the
   * Team tab's capacity line reads it against the live runs. Absent on
   * older runners.
   */
  readonly poolSize?: Readonly<Record<string, number>>;
  /** req-177: per slot (account) the busy count, the remaining share, its reliability, q and the reset — the 7e Capacity band's Slots row. Absent on older runners. */
  readonly slots?: readonly SlotSummary[];
  /** req-170: the capacity pool's live sum — "Now: 2.4 of 6 · Claude A 2 of 5" (the 7l page and the 7e band). Absent on older runners. */
  readonly pool?: PoolLoad;
  /** req-170: the tasks waiting for the pool, in the order they are served (the card's `queued · waits for a B slot`). Absent on older runners. */
  readonly queue?: readonly QueueEntry[];
  /** req-179: the current tranche — runs, spend, end, a waiting checkpoint and its report; absent on older runners or with tranches off. */
  readonly tranche?: TrancheStatus;
  /** req-181: why no new run starts although the Autopilot is On (the burn rate); null = nothing holds. Absent on older runners. */
  readonly hold?: ChainHold | null;
}

/**
 * The burn rate's hold (req-181): today's share of the weekly quota over all
 * slots reached `routing.burnRate` — no new run starts until `resumesAt`
 * (the next UTC midnight); running steps finish. `spent` and `limit` are
 * shares 0–1; `basis` says whether the figure was read or estimated.
 */
export interface BurnRateHold {
  readonly reason: 'burn-rate';
  readonly spent: number;
  readonly limit: number;
  readonly resumesAt: string;
  readonly basis: BurnRateBasis;
  /** When the hold rose (ISO): the card's time. */
  readonly since: string;
}

/** What can hold every new start while the Autopilot stays in its state (one reason today). */
export type ChainHold = BurnRateHold;

/** One circuit-breaker trip (the chain alerts fix). */
export interface ChainTrip {
  /** `3 red gates in a row`, `daily token budget spent`. */
  readonly reason: string;
  /** ISO instant of the trip. */
  readonly at: string;
}
