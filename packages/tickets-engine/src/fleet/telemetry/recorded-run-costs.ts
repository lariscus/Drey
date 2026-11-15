import type { RunInfo } from '../protocol';
import { isOneOnOne } from '../protocol-session';
import type { PriorRunCosts } from '../runner/closing-signal-rule';

/**
 * The persona's typical run from the runner's own records (req-169): the
 * settled ticket runs (done or failed) of that persona with a known cost,
 * newest first — a 1:1, a stopped run and a run without a cost do not count.
 */
export class RecordedRunCosts implements PriorRunCosts {
  constructor(private readonly records: () => readonly RunInfo[]) {}

  costsOf(persona: string, excludeRunId: string): readonly number[] {
    return this.records()
      .filter((info) => info.id !== excludeRunId && (info.persona ?? null) === persona)
      .filter((info) => (info.state === 'done' || info.state === 'failed') && info.costUsd !== null && !isOneOnOne(info))
      .map((info) => info.costUsd!);
  }
}
