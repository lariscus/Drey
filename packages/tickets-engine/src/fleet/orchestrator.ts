/**
 * The chain orchestrator (M85, ADR-0077, ADR-0096): the runner-side loop
 * that turns a configured pipeline into running workers. The board comes
 * from the dricket store the chain config names; the next dispatches are
 * planned by the pure rules of `chain.ts` and started through the
 * per-provider supervisors. The control state persists in
 * `<root>/chain.json`; the tickets repo never sees it (ADR-0076).
 *
 * The loop is event-driven with a slow safety net: a pass runs when the
 * config or a control state changes, when a run settles, and every scan
 * interval so external board moves are picked up with Drey closed. This
 * class is the surface; the parts live in `orchestrate/`.
 */
import { AUTOPILOT_OFF, autopilotOfMaster, resumeDue } from './autopilot';
import type { Clock } from './ports/clock';
import type { AutopilotRecord, ChainConfig, ChainMaster, ChainStatus, ColumnMode, RunInfo, RunRequest } from './protocol';
import { LIVE_RUN_STATES } from './run/run-state';
import type { ChainState } from './orchestrate/chain-state';
import type { ChainStateStore } from './orchestrate/chain-state-store';
import type { CiSweep } from './orchestrate/ci-sweep';
import type { Dispatcher } from './orchestrate/dispatcher';
import type { PoolCapacity } from './orchestrate/pool-capacity';
import type { FleetLedger, SettledRuns } from './orchestrate/settled-runs';
import type { SupervisorDirectory } from './orchestrate/supervisor-directory';

/** The E7 event sink the runner and the engine wire (concept §3.3). */
export type FleetEvents = FleetLedger;

/** The sampling audit's brief — a fresh second worker reviews the step. */
export const AUDIT_BRIEF =
  'You are the sampling auditor — a fresh second worker. Before this step may move on, review the work the branch ' +
  "contains against the ticket: correctness first, then the repo's conventions, then leftovers. Fix what you find; " +
  'the machine gate must stay green when you end.';

/** The semantic gate's brief — does the branch do the thing, and only the thing. */
export const SEMANTIC_BRIEF =
  "You are the semantic gate — a fresh second worker. Judge the step's result against what the ticket actually asked " +
  'for: does the branch do the thing, does it do only the thing, would the owner accept it? Fix what falls short; the ' +
  'machine gate must stay green when you end.';

export interface OrchestratorParts {
  readonly state: ChainState;
  readonly store: ChainStateStore;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
  readonly settled: SettledRuns;
  readonly dispatcher: Dispatcher;
  readonly ci: CiSweep;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The safety-net rescan interval. */
  readonly scanIntervalMs: number;
}

export class Orchestrator {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly parts: OrchestratorParts) {}

  /** Loads `chain.json`; the Autopilot boots Off (written back), except across a fresh handover. */
  async load(): Promise<void> {
    if (await this.parts.store.load(this.parts.state)) {
      await this.persist();
    }
    this.startTimer();
  }

  status(): ChainStatus {
    return this.parts.state.status({ quotaPausedUntil: this.parts.pools.quotaPausedUntil(), poolSize: this.parts.pools.sizes(this.parts.state.config) });
  }

  /** Points the chain at a board (idempotent) and scans. */
  async configure(config: ChainConfig): Promise<ChainStatus> {
    const was = this.parts.state.config;
    const same =
      was !== null &&
      (['ticketsVaultPath', 'git', 'defaultWorker', 'permissionMode'] as const).every((key) => was[key] === config[key]) &&
      JSON.stringify(was.store ?? null) === JSON.stringify(config.store ?? null) &&
      JSON.stringify(was.pools ?? null) === JSON.stringify(config.pools ?? null);
    this.parts.state.config = config;
    if (!same) {
      await this.persist();
    }
    this.startTimer();
    await this.parts.dispatcher.pass();
    return this.status();
  }

  /** The Autopilot switch (req-95): On dispatches at once, Paused and Off start nothing new and leave running work alone. */
  async setAutopilot(record: AutopilotRecord): Promise<ChainStatus> {
    const was = this.parts.state.autopilot;
    if (record.state !== was.state || record.resumeAt !== was.resumeAt) {
      this.parts.log(`autopilot: ${record.state}${record.resumeAt === undefined ? '' : ` until ${record.resumeAt}`}`);
    }
    this.parts.state.autopilot = record;
    await this.persist();
    if (record.resumeAt !== undefined) {
      this.startTimer();
    }
    if (this.parts.state.master === 'run') {
      await this.parts.dispatcher.pass();
    }
    return this.status();
  }

  /** The two-state master API stays: `run` is On, `halted` is Off. */
  setMaster(mode: ChainMaster): Promise<ChainStatus> {
    return this.setAutopilot(autopilotOfMaster(mode));
  }

  /** Paused turns On once its resume time has come (the wall clock: it survives a sleeping machine). */
  async resumeIfDue(): Promise<void> {
    if (resumeDue(this.parts.state.autopilot, this.parts.clock.now())) {
      await this.setAutopilot({ state: 'on' });
    }
  }

  async setColumn(phaseId: string, mode: ColumnMode): Promise<ChainStatus> {
    const { state } = this.parts;
    state.columns[phaseId] = mode;
    if (mode === 'playing') {
      delete state.tripped[phaseId]; // the owner's play is a fresh start: the old streak would trip again at once
      state.redStreak[phaseId] = 0;
    }
    await this.persist();
    if (mode === 'playing') {
      await this.parts.dispatcher.pass();
    }
    return this.status();
  }

  /** A runner retiring for a newer build: the successor's load keeps the master. */
  async markHandover(): Promise<void> {
    await this.parts.store.persist(this.parts.state, this.parts.clock.now().toISOString());
  }

  /** Notaus: halt the chain, then abort every live run through the stop ladder. */
  async abortAll(): Promise<ChainStatus> {
    this.parts.state.autopilot = AUTOPILOT_OFF;
    await this.persist();
    await this.parts.directory.stopMatching((record) => LIVE_RUN_STATES.includes(record.info.state), 'chain emergency stop (Notaus)');
    return this.status();
  }

  /** Stops one column's live runs and holds the column (the brake). */
  async stopColumn(phaseId: string): Promise<ChainStatus> {
    this.parts.state.columns[phaseId] = 'held';
    await this.persist();
    await this.parts.directory.stopMatching((r) => LIVE_RUN_STATES.includes(r.info.state) && (r.request.column ?? null) === phaseId, `column ${phaseId} stopped`);
    return this.status();
  }

  /** The persona pause (U4): a paused persona's tickets hold until it is played again; a live run finishes its step. */
  async setPersonaPaused(persona: string, paused: boolean): Promise<ChainStatus> {
    const id = persona.trim();
    const set = this.parts.state.pausedPersonas;
    if (set.has(id) === paused) {
      return this.status();
    }
    if (paused) {
      set.add(id);
      this.parts.log(`persona "${id}" paused — its tickets hold until the persona is played again`);
    } else {
      set.delete(id);
      this.parts.log(`persona "${id}" played again — its tickets dispatch normally`);
    }
    await this.persist();
    if (this.parts.state.master === 'run') {
      await this.parts.dispatcher.pass();
    }
    return this.status();
  }

  /** The supervisors' run-settled hook (M85): the books, then a fresh pass — the slot is free. */
  async onRunSettled(info: RunInfo): Promise<void> {
    await this.parts.settled.onSettled(info);
    await this.parts.dispatcher.pass();
  }

  /** Whether the board this chain drives lives in a dricket store (D-42). */
  onStore(): boolean {
    return this.parts.state.config?.store !== undefined;
  }

  /** The supervisors' lease-reaper round (the runner's timer calls this). */
  reapAll(): Promise<void> {
    return this.parts.directory.reapAll();
  }

  /**
   * The quality rungs' decision (M85, flagged off): a run in a column with
   * `audit:` (sampled) or `semantic: true` (always) gets a second worker
   * before its move — the brief prefixes the run's own instruction.
   */
  async secondOpinion(request: RunRequest): Promise<string | null> {
    const phase = this.parts.state.phases.find((p) => p.id === (request.column ?? null));
    const sampled = phase !== undefined && phase.audit !== null && Math.random() < phase.audit;
    if (phase === undefined || (!sampled && phase.semantic !== true)) {
      return null;
    }
    return `${phase.semantic === true ? SEMANTIC_BRIEF : AUDIT_BRIEF}\n\n---\n\n${request.instruction}`;
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** True while the chain would dispatch again. */
  get active(): boolean {
    return this.parts.state.config !== null && this.parts.state.master === 'run';
  }

  /** An On chain drains the board, and a Paused one holds a state a restart would lose: both keep the runner. */
  get keepsRunnerAlive(): boolean {
    return this.parts.state.config !== null && this.parts.state.autopilot.state !== 'off';
  }

  /** The pass read the pipeline: the control state of phases it no longer has goes. */
  async pipelineRead(): Promise<void> {
    if (this.parts.state.prune(new Set(this.parts.state.phases.map((p) => p.id)))) {
      await this.persist();
    }
  }

  persist(): Promise<void> {
    return this.parts.store.persist(this.parts.state);
  }

  private startTimer(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.resumeIfDue();
      if (this.parts.state.config !== null) {
        void this.parts.ci.sweep();
      }
      if (this.active) {
        void this.parts.dispatcher.pass();
      }
    }, this.parts.scanIntervalMs);
    this.timer.unref();
  }
}
