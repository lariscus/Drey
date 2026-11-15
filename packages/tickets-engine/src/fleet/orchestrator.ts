/**
 * The chain orchestrator (M85, ADR-0077, ADR-0096): the runner-side loop
 * that turns a configured pipeline into running workers. The board comes
 * from the dricket store the chain config names; the next dispatches are
 * planned by the pure rules of `holder-plan.ts` and started through the
 * per-provider supervisors. The control state persists per tickets vault in
 * `<root>/chains/<vault key>/chain.json` (req-173); the tickets repo never sees it (ADR-0076).
 *
 * The loop is event-driven with a slow safety net: a pass runs when the
 * config or a control state changes, when a run settles, and every scan
 * interval so external board moves are picked up with Drey closed. This
 * class is the surface; the parts live in `orchestrate/`.
 */
import { AUTOPILOT_OFF, autopilotOfMaster, resumeDue } from './autopilot';
import type { Clock } from './ports/clock';
import { WORKER_PROVIDERS, type AutopilotRecord, type ChainConfig, type ChainMaster, type ChainStatus, type ColumnMode, type RunInfo, type SlotSummary } from './protocol';
import type { DispatchPool } from './orchestrate/dispatch-pool';
import { LIVE_RUN_STATES } from './run/run-state';
import type { ChainState, ChainVaultLocator } from './orchestrate/chain-state';
import type { ChainStateStore } from './orchestrate/chain-state-store';
import type { Dispatcher } from './orchestrate/dispatcher';
import type { PoolCapacity } from './orchestrate/pool-capacity';
import type { StartHold } from './orchestrate/start-hold';
import type { FleetLedger, SettledRuns } from './orchestrate/settled-runs';
import type { SupervisorDirectory } from './orchestrate/supervisor-directory';

/** The E7 event sink the runner and the engine wire (concept §3.3). */
export type FleetEvents = FleetLedger;

export interface OrchestratorParts {
  readonly state: ChainState;
  readonly store: ChainStateStore;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
  readonly settled: SettledRuns;
  readonly dispatcher: Dispatcher;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The safety-net rescan interval. */
  readonly scanIntervalMs: number;
  /** req-177: the slots' summary for the 7e band; absent = the status carries none. */
  readonly slots?: SlotSummarySource;
  /** req-170: the capacity pool — its live load and queue ride the chain status. */
  readonly pool?: DispatchPool;
  /** req-170: the one-time move of the old pool sizes into `service.json`. */
  readonly migratePools?: (config: ChainConfig) => Promise<void>;
  /** req-173: the config of a vault resolved from its `_meta/crew.md` at boot, before the board sends one. */
  readonly restoreConfig?: (vault: ChainVaultLocator) => Promise<ChainConfig | null>;
  /** The write of `chain.json`; absent = the store's write alone. */
  readonly persist?: () => Promise<void>;
  /** req-181: the burn rate's hold — on the status, and lifted for the day by the owner. */
  readonly hold?: StartHold;
}

/** Where the chain status reads the slots from (`fleet/routing`'s registry satisfies it). */
export interface SlotSummarySource {
  summary(): readonly SlotSummary[];
}

export class Orchestrator {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly parts: OrchestratorParts) {}

  /**
   * Loads the last vault's `chain.json`; the Autopilot boots Off (written back), except across a fresh
   * handover. req-173: the config is resolved again from that vault's `_meta/crew.md`, never read from the file.
   */
  async load(): Promise<void> {
    const moving = await this.parts.store.load(this.parts.state);
    const vault = this.parts.state.vault;
    if (vault !== null && this.parts.state.config === null && this.parts.restoreConfig !== undefined) {
      this.parts.state.config = await this.parts.restoreConfig(vault).catch(() => null);
    }
    if (moving) {
      await this.persist();
    }
    this.startTimer();
  }

  status(): ChainStatus {
    const status = this.parts.state.status({ quotaPausedUntil: this.parts.pools.quotaPausedUntil(), poolSize: this.poolSizes() });
    const pool = this.parts.pool;
    const withSlots = this.parts.slots === undefined ? status : { ...status, slots: this.parts.slots.summary() };
    const withHold = this.parts.hold === undefined ? withSlots : { ...withSlots, hold: this.parts.hold.current() };
    return pool === undefined ? withHold : { ...withHold, pool: pool.load(), queue: pool.queue.list() };
  }

  /** The effective parallel runs per provider; a provider without a bound of its own is left out. */
  private poolSizes(): Record<string, number> {
    const pool = this.parts.pool;
    const sizes = this.parts.pools.sizes(this.parts.state.config, pool === undefined ? undefined : (provider) => pool.sessionsOf(provider));
    return Object.fromEntries(WORKER_PROVIDERS.filter((provider) => sizes[provider] < Number.MAX_SAFE_INTEGER).map((provider) => [provider, sizes[provider]]));
  }

  /** Points the chain at a board (idempotent) and scans. */
  async configure(config: ChainConfig): Promise<ChainStatus> {
    const switched = await this.parts.store.switchTo(this.parts.state, config); // req-173: one chain.json per vault
    this.parts.state.config = config;
    if (switched) {
      await this.persist();
    }
    await this.parts.migratePools?.(config);
    this.startTimer();
    await this.parts.dispatcher.pass();
    return this.status();
  }

  /** The Autopilot switch (req-95): On dispatches at once, Paused and Off start nothing new and leave running work alone. */
  async setAutopilot(asked: AutopilotRecord): Promise<ChainStatus> {
    const was = this.parts.state.autopilot;
    if (asked.state !== was.state || asked.resumeAt !== was.resumeAt) {
      this.parts.log(`autopilot: ${asked.state}${asked.resumeAt === undefined ? '' : ` until ${asked.resumeAt}`}`);
    }
    this.parts.state.autopilot = asked;
    await this.persist();
    if (asked.resumeAt !== undefined) {
      this.startTimer();
    }
    if (this.parts.state.master === 'run') {
      await this.parts.dispatcher.pass();
    }
    return this.status();
  }

  /** req-181: "Allow today once" — the burn rate holds nothing more until the day turns; an On chain dispatches at once. */
  async liftHold(): Promise<ChainStatus> {
    await this.parts.hold?.lift();
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
      delete this.parts.state.personaTripped[id]; // req-257: playing a tripped persona resets its breaker
      this.parts.state.personaRedStreak[id] = 0;
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
    return this.parts.persist?.() ?? this.parts.store.persist(this.parts.state);
  }

  private startTimer(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.resumeIfDue();
      if (this.active) {
        void this.parts.dispatcher.pass();
      }
    }, this.parts.scanIntervalMs);
    this.timer.unref();
  }
}
