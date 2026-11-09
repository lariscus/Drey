import type { Clock } from '../../ports/clock';
import { normalizeTranche, tranchesOff, tranchesPerDay, type AutopilotRecord, type RunInfo, type TrancheConfig, type TrancheStatus } from '../../protocol';
import type { ChainState } from '../chain-state';
import type { AnomalyDetector } from './anomaly-detector';
import type { CheckpointReporter } from './checkpoint-reporter';
import { spentOf } from './figures';
import type { RunFacts } from './run-facts';
import type { TrancheBudget } from './tranche-budget';
import { checkpointLine, earlyStopLine, releasedLine, startedLine } from './tranche-lines';
import type { TrancheLedger } from './tranche-ledger';
import type { TrancheCheckpoint, TrancheRecord } from './tranche-record';

export interface TranchesDeps {
  readonly state: ChainState;
  readonly ledger: TrancheLedger;
  readonly budget: TrancheBudget;
  readonly reporter: CheckpointReporter;
  readonly detector: AnomalyDetector;
  readonly facts: RunFacts;
  readonly clock: Clock;
  readonly log: (message: string) => void;
}

/**
 * The tranche as the Autopilot's release unit (req-179, ADR-0077 later
 * change): On releases one tranche; each start counts against it; each
 * settled run of it becomes a fact the early-stop rules read; when a limit
 * is reached or a rule fires, the Autopilot pauses itself (Paused, reason
 * checkpoint) and the status carries the report. The caller persists.
 */
export class Tranches {
  constructor(private readonly deps: TranchesDeps) {}

  /** The tranche settings in force; null with tranches off or no chain config. */
  config(): TrancheConfig | null {
    const config = this.deps.state.config === null ? null : normalizeTranche(this.deps.state.config.tranche);
    return config === null || tranchesOff(config) ? null : config;
  }

  status(): TrancheStatus | null {
    const config = this.config();
    const record = this.deps.ledger.current();
    if (config === null || record === null) {
      return null;
    }
    const limits = this.deps.budget.limits(record, config);
    return {
      index: record.index,
      of: tranchesPerDay(config),
      done: record.started,
      total: limits.total,
      spent: spentOf(record.facts),
      budget: limits.budget,
      startedAt: record.startedAt,
      endsAt: limits.endsAt,
      checkpoint: record.checkpoint === null ? null : 'waiting',
      report: record.checkpoint === null ? null : this.deps.reporter.report(record, record.checkpoint),
    };
  }

  /** The dispatcher's release gate: nothing new starts while a checkpoint waits or the tranche is spent. */
  mayStart(): boolean {
    const config = this.config();
    const record = this.deps.ledger.current();
    return config === null || record === null || (record.checkpoint === null && this.deps.budget.exhaustedBy(record, config) === null);
  }

  /** A run the chain started: it counts; the last run of the limit raises the checkpoint at once. */
  started(ticket: string): void {
    const config = this.config();
    if (config === null) {
      return;
    }
    if (this.deps.ledger.current() === null) {
      this.open(); // a chain that was On before tranches existed (a handover) gets its first one here
    }
    this.deps.ledger.started(ticket);
    const status = this.status();
    if (status !== null) {
      this.deps.log(startedLine(status));
    }
    this.review();
  }

  /** A settled run of this tranche: its fact, then the early-stop rules, then the budget. True when anything changed. */
  async settled(info: RunInfo): Promise<boolean> {
    const config = this.config();
    if (config === null || this.deps.ledger.current() === null) {
      return false;
    }
    const fact = await this.deps.facts.of(info, this.deps.clock.now().toISOString());
    if (!this.deps.ledger.settled(fact)) {
      return false;
    }
    const record = this.deps.ledger.current()!;
    if (record.checkpoint === null) {
      const early = this.deps.detector.check({ facts: record.facts.slice(record.anomalyFrom), runsLeft: this.deps.budget.runsLeft(record, config) }, config.earlyStop);
      if (early !== null) {
        this.raise({ kind: 'early', at: fact.at, endedBy: null, earlyStop: early });
        return true;
      }
    }
    this.review();
    return true;
  }

  /** A limit reached (the time span runs out between events): the checkpoint. True when one was raised. */
  review(): boolean {
    const config = this.config();
    const record = this.deps.ledger.current();
    const endedBy = config === null || record === null || record.checkpoint !== null ? null : this.deps.budget.exhaustedBy(record, config);
    if (endedBy === null) {
      return false;
    }
    this.raise({ kind: 'end', at: this.deps.clock.now().toISOString(), endedBy, earlyStop: null });
    return true;
  }

  /**
   * The owner's switch, before it applies: On after a checkpoint (or with
   * the tranche spent) releases the next tranche; On after an early stop
   * ("Release anyway") goes on with the same one; Paused while a checkpoint
   * waits keeps the reason.
   */
  onAutopilot(next: AutopilotRecord): AutopilotRecord {
    const config = this.config();
    const record = this.deps.ledger.current();
    if (config === null) {
      return next;
    }
    if (next.state === 'paused') {
      return record?.checkpoint != null ? { ...next, reason: 'checkpoint' } : next;
    }
    if (next.state === 'on') {
      this.release(record, config);
    }
    return next;
  }

  private release(record: TrancheRecord | null, config: TrancheConfig): void {
    if (record !== null && record.checkpoint?.kind === 'early') {
      this.deps.ledger.continueAfterEarlyStop();
      this.deps.log(`tranche ${record.index} released again after the early stop — the rules look past it`);
      if (this.deps.budget.exhaustedBy(this.deps.ledger.current()!, config) === null) {
        return;
      }
    } else if (record !== null && record.checkpoint === null && this.deps.budget.exhaustedBy(record, config) === null) {
      return; // the same tranche goes on (a pause, an Off, a restart)
    }
    this.open();
  }

  private open(): void {
    this.deps.ledger.open();
    const status = this.status();
    if (status !== null) {
      this.deps.log(releasedLine(status));
    }
  }

  /** The checkpoint: recorded, logged, and an On Autopilot pauses itself (running steps finish, nothing new starts). */
  private raise(checkpoint: TrancheCheckpoint): void {
    this.deps.ledger.raise(checkpoint);
    const status = this.status();
    if (status?.report != null) {
      this.deps.log(checkpoint.earlyStop !== null ? earlyStopLine(checkpoint.earlyStop) : checkpointLine(status, status.report));
    }
    if (this.deps.state.autopilot.state === 'on') {
      this.deps.state.autopilot = { state: 'paused', reason: 'checkpoint' };
    }
  }
}
