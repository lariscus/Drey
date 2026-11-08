import type { RunInfo } from '../protocol';

/** What one run may spend before the reaper stops it. */
export interface RunLimits {
  /** Model turns (the telemetry's count — an upper estimate). */
  readonly maxTurns: number;
  /** Working time in ms: busy spans only, a wait for the owner does not tick. */
  readonly maxWorkMs: number;
}

/**
 * Observed on the live fleet: ordinary runs end within 20 turns / 20 minutes,
 * the heavy legitimate ones within ~170 turns / 76 minutes; the runaways
 * (400 turns, 128 min, 87 M tokens in) are what these stop.
 */
export const DEFAULT_RUN_LIMITS: RunLimits = { maxTurns: 250, maxWorkMs: 90 * 60_000 };

/** The reason a run passed its ceiling, or null while it stays inside (0 = unlimited). */
export function limitExceeded(info: RunInfo, limits: RunLimits, nowMs: number): string | null {
  const turns = info.turns ?? 0;
  if (limits.maxTurns > 0 && turns > limits.maxTurns) {
    return `${turns} turns, over the limit of ${limits.maxTurns}`;
  }
  const open = info.execSince !== undefined && info.execSince !== null ? nowMs - (Date.parse(info.execSince) || nowMs) : 0;
  const worked = (info.execMs ?? 0) + Math.max(0, open);
  if (limits.maxWorkMs > 0 && worked > limits.maxWorkMs) {
    return `${Math.round(worked / 60_000)} min of work, over the limit of ${Math.round(limits.maxWorkMs / 60_000)} min`;
  }
  return null;
}
