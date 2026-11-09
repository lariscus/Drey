// ---------------------------------------------------------------------------
// Tranches (req-179, ADR-0077 later change 2026-11-09): the Autopilot's On
// releases one tranche — up to N runs, a share of the day's budget or a time
// span, whichever ends first. At its end the runner pauses the Autopilot
// (Paused, reason checkpoint) and the chain status carries a checkpoint
// report; an anomaly stops the tranche early. The thresholds ride the chain
// config (the plugin's `autopilot.tranche.*` keys); the counters live in
// `chain.json`.

/** The early-stop rules (each null = off). */
export interface EarlyStopConfig {
  /** Falling gate rate: this many red among the last `gateWindow` gates stops the tranche. */
  readonly redGates: number | null;
  readonly gateWindow: number;
  /** The same ticket red this many times in the tranche stops it. */
  readonly sameTicketRed: number | null;
  /** A run's change size above this factor times the tranche's median stops it. */
  readonly changeFactor: number | null;
  /** A run's cost above this factor times the tranche's median stops it. */
  readonly costFactor: number | null;
  /** Runs with a figure the tranche needs before the two median rules apply. */
  readonly minRuns: number;
}

export interface TrancheConfig {
  /** Runs one tranche releases; null = no run limit. */
  readonly runs: number | null;
  /** Share (0–1] of the day's provider ledger one tranche may spend; null = no budget limit. */
  readonly budgetShare: number | null;
  /** Minutes one tranche lasts from its release; null = no time limit. */
  readonly minutes: number | null;
  readonly earlyStop: EarlyStopConfig;
}

export const DEFAULT_EARLY_STOP: EarlyStopConfig = { redGates: 3, gateWindow: 6, sameTicketRed: 2, changeFactor: 3, costFactor: 3, minRuns: 3 };

export const DEFAULT_TRANCHE: TrancheConfig = { runs: 10, budgetShare: 0.33, minutes: 240, earlyStop: DEFAULT_EARLY_STOP };

/** The rule that stopped a tranche early. */
export type AnomalyRule = 'gate_rate' | 'same_ticket' | 'change_growth' | 'cost_outlier';

/** What ended a tranche at its end (not early). */
export type TrancheEnd = 'runs' | 'budget' | 'time';

/** One red ticket of an early stop (board 10u part 6: `T-0119 · build · Ben · red twice`). */
export interface RedTicket {
  readonly ticket: string;
  readonly phase: string | null;
  readonly persona: string | null;
  /** Red gates of this ticket in the tranche. */
  readonly red: number;
}

/** Why a tranche stopped early, with the numbers the card and the log say. */
export interface EarlyStop {
  readonly rule: AnomalyRule;
  /** gate_rate: the red gates among the window; same_ticket: the ticket's red gates. */
  readonly red: number;
  /** gate_rate: the window's size; else the gates the tranche saw. */
  readonly window: number;
  /** The runs the tranche had left; null without a run limit. */
  readonly runsLeft: number | null;
  /** The run that tripped a median rule (or the repeated ticket), its figure and the median it was measured against. */
  readonly ticket: string | null;
  readonly value: number | null;
  readonly median: number | null;
  /** The red tickets behind a gate rule, newest first. */
  readonly tickets: readonly RedTicket[];
}

/** The deterministic numbers of a tranche (board 10u part 1); no model writes any of it. */
export interface CheckpointReport {
  readonly kind: 'end' | 'early';
  /** ISO instant the checkpoint was raised. */
  readonly at: string;
  readonly endedBy: TrancheEnd | null;
  readonly runs: number;
  readonly spent: number;
  /** Minutes from the release to the checkpoint. */
  readonly minutes: number;
  readonly gates: { readonly green: number; readonly total: number };
  /** Median lines added and removed per run; null while no run reported a change. */
  readonly change: { readonly added: number; readonly removed: number } | null;
  /** Median and highest cost per run; null while no run reported a cost. */
  readonly cost: { readonly median: number; readonly max: number } | null;
  /** The ticket that ran most often, twice or more; null when none repeated. */
  readonly repeated: { readonly ticket: string; readonly runs: number } | null;
  readonly earlyStop: EarlyStop | null;
}

/** The tranche as the chain status (and so `GET /chain`, the fleet snapshot, Mission Control) carries it. */
export interface TrancheStatus {
  /** The tranche's number today (1-based) and the tranches a day's budget holds; null without a budget share. */
  readonly index: number;
  readonly of: number | null;
  /** Runs released in this tranche, of the run limit (null = none). */
  readonly done: number;
  readonly total: number | null;
  /** Dollars the tranche's settled runs spent, of its budget (null = none). */
  readonly spent: number;
  readonly budget: number | null;
  readonly startedAt: string;
  /** ISO instant the time span ends; null without one. */
  readonly endsAt: string | null;
  readonly checkpoint: 'waiting' | null;
  /** The report while a checkpoint waits; null otherwise. */
  readonly report: CheckpointReport | null;
}

const positive = (value: unknown, integer: boolean): number | null | undefined => {
  if (value === null || value === 0 || value === false) {
    return null; // explicitly off
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined; // not given or junk: the default
  }
  return integer ? Math.max(1, Math.round(value)) : value;
};

const pick = (raw: Readonly<Record<string, unknown>>, key: string, integer: boolean, fallback: number | null): number | null => {
  const given = positive(raw[key], integer);
  return given === undefined ? fallback : given;
};

const count = (raw: Readonly<Record<string, unknown>>, key: string, fallback: number): number => pick(raw, key, true, fallback) ?? fallback;

/** A request body's tranche settings; absent or junk keys fall back per key (an older plugin keeps a newer runner working). */
export function normalizeTranche(value: unknown): TrancheConfig {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const early = (typeof raw['earlyStop'] === 'object' && raw['earlyStop'] !== null ? raw['earlyStop'] : {}) as Record<string, unknown>;
  const share = pick(raw, 'budgetShare', false, DEFAULT_TRANCHE.budgetShare);
  return {
    runs: pick(raw, 'runs', true, DEFAULT_TRANCHE.runs),
    budgetShare: share === null ? null : Math.min(1, share),
    minutes: pick(raw, 'minutes', true, DEFAULT_TRANCHE.minutes),
    earlyStop: {
      redGates: pick(early, 'redGates', true, DEFAULT_EARLY_STOP.redGates),
      gateWindow: count(early, 'gateWindow', DEFAULT_EARLY_STOP.gateWindow),
      sameTicketRed: pick(early, 'sameTicketRed', true, DEFAULT_EARLY_STOP.sameTicketRed),
      changeFactor: pick(early, 'changeFactor', false, DEFAULT_EARLY_STOP.changeFactor),
      costFactor: pick(early, 'costFactor', false, DEFAULT_EARLY_STOP.costFactor),
      minRuns: count(early, 'minRuns', DEFAULT_EARLY_STOP.minRuns),
    },
  };
}

/** No limit at all: the Autopilot runs without tranches (the behaviour before req-179). */
export function tranchesOff(config: TrancheConfig): boolean {
  return config.runs === null && config.budgetShare === null && config.minutes === null;
}

/** The tranches one day's budget holds (`tranche 1 of 3`); null without a budget share. */
export function tranchesPerDay(config: TrancheConfig): number | null {
  return config.budgetShare === null ? null : Math.max(1, Math.round(1 / config.budgetShare));
}
