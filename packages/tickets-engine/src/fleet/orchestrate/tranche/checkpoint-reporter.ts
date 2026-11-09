import type { CheckpointReport } from '../../protocol';
import { changeOf, dollars, gated, median, spentOf } from './figures';
import type { RunFact, TrancheCheckpoint, TrancheRecord } from './tranche-record';

/**
 * The checkpoint report (req-179, board 10u part 1): gate rate, change size,
 * cost per run and repeated tickets — deterministic numbers over the
 * tranche's run facts, no model prompt. Recomputed on every read, so a run
 * that settles after the pause still lands in the report it belongs to.
 */
export class CheckpointReporter {
  report(record: TrancheRecord, checkpoint: TrancheCheckpoint): CheckpointReport {
    const facts = record.facts;
    const gates = gated(facts);
    return {
      kind: checkpoint.kind,
      at: checkpoint.at,
      endedBy: checkpoint.endedBy,
      runs: record.started,
      spent: spentOf(facts),
      minutes: Math.max(0, Math.round((Date.parse(checkpoint.at) - Date.parse(record.startedAt)) / 60_000)),
      gates: { green: gates.filter((fact) => fact.gate === 'green').length, total: gates.length },
      change: this.change(facts),
      cost: this.cost(facts),
      repeated: this.repeated(facts),
      earlyStop: checkpoint.earlyStop,
    };
  }

  /** Median lines added and removed, over the runs whose worktree was read. */
  private change(facts: readonly RunFact[]): CheckpointReport['change'] {
    const read = facts.filter((fact) => changeOf(fact) !== null);
    const added = median(read.map((fact) => fact.added ?? 0));
    const removed = median(read.map((fact) => fact.removed ?? 0));
    return added === null || removed === null ? null : { added: Math.round(added), removed: Math.round(removed) };
  }

  private cost(facts: readonly RunFact[]): CheckpointReport['cost'] {
    const costs = facts.map((fact) => fact.costUsd).filter((cost): cost is number => cost !== null);
    const mid = median(costs);
    return mid === null ? null : { median: dollars(mid), max: dollars(Math.max(...costs)) };
  }

  /** The ticket with the most runs, twice or more; a tie goes to the one that ran first. */
  private repeated(facts: readonly RunFact[]): CheckpointReport['repeated'] {
    const runs = new Map<string, number>();
    for (const fact of facts) {
      runs.set(fact.ticket, (runs.get(fact.ticket) ?? 0) + 1);
    }
    let best: { ticket: string; runs: number } | null = null;
    for (const [ticket, count] of runs) {
      if (count >= 2 && (best === null || count > best.runs)) {
        best = { ticket, runs: count };
      }
    }
    return best;
  }
}
