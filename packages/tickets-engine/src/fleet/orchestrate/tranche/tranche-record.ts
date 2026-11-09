import type { EarlyStop, TrancheEnd } from '../../protocol';

/** What one settled run of a tranche left behind — the report and the early-stop rules read only these. */
export interface RunFact {
  readonly runId: string;
  readonly ticket: string;
  readonly phase: string | null;
  readonly persona: string | null;
  /** The machine gate's verdict; null when no gate ran (a scout, a block, a stop). */
  readonly gate: 'green' | 'red' | null;
  readonly costUsd: number | null;
  /** Lines the run's commits added and removed; null when the worktree could not be read. */
  readonly added: number | null;
  readonly removed: number | null;
  /** ISO instant the run settled. */
  readonly at: string;
}

/** A raised checkpoint: why and when; the report's numbers are computed from the facts. */
export interface TrancheCheckpoint {
  readonly kind: 'end' | 'early';
  readonly at: string;
  readonly endedBy: TrancheEnd | null;
  readonly earlyStop: EarlyStop | null;
}

/** The tranche counters `chain.json` keeps (req-179): a restarted runner continues the same tranche. */
export interface TrancheRecord {
  /** 1-based, per UTC day. */
  readonly index: number;
  /** The UTC date the tranche was released on (the index restarts each day). */
  readonly day: string;
  readonly startedAt: string;
  /** Runs released (started) in this tranche. */
  readonly started: number;
  /** Tickets started and not settled yet: a settle of one of them is a fact of this tranche. */
  readonly pending: readonly string[];
  readonly facts: readonly RunFact[];
  /** The early-stop rules look at the facts from here on ("Release anyway" moves it past the anomaly). */
  readonly anomalyFrom: number;
  readonly checkpoint: TrancheCheckpoint | null;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isFigure = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function factOf(value: unknown): RunFact | null {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const gate = raw['gate'] === 'green' || raw['gate'] === 'red' ? raw['gate'] : null;
  if (!isText(raw['runId']) || !isText(raw['ticket']) || !isText(raw['at'])) {
    return null;
  }
  const figure = (key: string): number | null => (isFigure(raw[key]) ? (raw[key] as number | null) : null);
  return { runId: raw['runId'], ticket: raw['ticket'], phase: textOrNull(raw['phase']), persona: textOrNull(raw['persona']), gate, costUsd: figure('costUsd'), added: figure('added'), removed: figure('removed'), at: raw['at'] };
}

const endOf = (value: unknown): TrancheEnd | null => (value === 'runs' || value === 'budget' || value === 'time' ? value : null);

function checkpointOf(value: unknown): TrancheCheckpoint | null {
  const raw = (typeof value === 'object' && value !== null ? value : null) as Record<string, unknown> | null;
  if (raw === null || (raw['kind'] !== 'end' && raw['kind'] !== 'early') || !isText(raw['at'])) {
    return null;
  }
  const endedBy = endOf(raw['endedBy']);
  const earlyStop = raw['kind'] === 'early' && typeof raw['earlyStop'] === 'object' && raw['earlyStop'] !== null ? (raw['earlyStop'] as EarlyStop) : null;
  return { kind: raw['kind'], at: raw['at'], endedBy, earlyStop };
}

/** The record as `chain.json` holds it; null when the file has none or a torn one. */
export function restoreTranche(value: unknown): TrancheRecord | null {
  const raw = (typeof value === 'object' && value !== null ? value : null) as Record<string, unknown> | null;
  if (raw === null || !isCount(raw['index']) || !isText(raw['day']) || !isText(raw['startedAt']) || Number.isNaN(Date.parse(raw['startedAt']))) {
    return null;
  }
  const facts = (Array.isArray(raw['facts']) ? raw['facts'] : []).map(factOf).filter((fact): fact is RunFact => fact !== null);
  const pending = (Array.isArray(raw['pending']) ? raw['pending'] : []).filter(isText);
  const from = isCount(raw['anomalyFrom']) ? Math.min(raw['anomalyFrom'], facts.length) : 0;
  return {
    index: Math.max(1, raw['index']),
    day: raw['day'],
    startedAt: raw['startedAt'],
    started: isCount(raw['started']) ? raw['started'] : 0,
    pending,
    facts,
    anomalyFrom: from,
    checkpoint: checkpointOf(raw['checkpoint']),
  };
}
