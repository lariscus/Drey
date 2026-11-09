import type { RunFact, TrancheRecord } from './tranche-record';

/** A moving clock for the tranche specs. */
export class FakeClock {
  constructor(public current: Date = new Date('2026-11-09T12:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }

  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

let counter = 0;

/** One settled run; every figure can be overridden. */
export function fact(over: Partial<RunFact> = {}): RunFact {
  counter += 1;
  return {
    runId: `R-${counter}`,
    ticket: 'T-0100',
    phase: 'build',
    persona: 'ben',
    gate: 'green',
    costUsd: 0.4,
    added: 100,
    removed: 20,
    at: '2026-11-09T12:30:00.000Z',
    ...over,
  };
}

/** A tranche record released at noon. */
export function record(over: Partial<TrancheRecord> = {}): TrancheRecord {
  return { index: 1, day: '2026-11-09', startedAt: '2026-11-09T12:00:00.000Z', started: 0, pending: [], facts: [], anomalyFrom: 0, checkpoint: null, ...over };
}
