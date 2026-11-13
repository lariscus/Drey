/**
 * The engine's side of the fleet (ADR-0075, M84): find or wake the Crew
 * runner, then proxy Run/Stop/Steer/Watch to its loopback HTTP surface.
 * Since Drey Service (req-164, ADR-0092) the runner is a component of the
 * same process as the engine: the {@link RunnerLocator} says where it
 * listens (null while it sleeps) and wakes it — nothing is spawned here,
 * and a stale build is the service's matter (Drey hands the whole service
 * over), not this client's.
 *
 * The engine never touches worker pipes; it sees runs through
 * `GET /status` (polled onto the board while anything is live) and the
 * stream files via `GET /stream/:id` for the watch view.
 */
import type { ExecFn } from '../fleet/procs';
import type { AutopilotRecord, AutopilotRefusal, ChainConfig, ChainMaster, ChainStatus, ChainStoreConfig, ColumnMode, ModelsReply, QuestionAnswers, RunInfo, RunRequest, SlotView } from '../fleet/protocol';
import { RunHistory } from './run-history';
import { RunnerConnection, type RunnerLocator } from './runner-connection';

export type { RunnerLocator } from './runner-connection';

/** `GET /slots` (req-177): every slot and where `service.json` lives. */
export interface SlotsReply {
  readonly ok: true;
  readonly slots: readonly SlotView[];
  readonly configPath: string;
}

export interface FleetClientOpts {
  /** The fleet root — `<engine home>/fleet` (runs, worktrees, chain state). */
  readonly root: string;
  /** The runner component (req-164): its endpoint and its wake. */
  readonly runner: RunnerLocator;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** Pushed whenever the polled run list or chain state differs — the board re-renders. */
  readonly onFleetChanged: (fleet: FleetSnapshot) => void;
  /** Test seam over the process probes of a detached record (D-34). */
  readonly exec?: ExecFn;
}

/** What the plugin pushes to the renderer: the runs plus the chain's control state. */
export interface FleetSnapshot {
  readonly runs: readonly RunInfo[];
  readonly chain: ChainStatus | null;
}

type StartOutcome = { readonly ok: true; readonly run: RunInfo } | { readonly ok: false; readonly error: string };

/** What `retireIfIdle` found (req-110): gone, or why the runner stays. */
export type RetireReply =
  | { readonly ok: true; readonly exiting: true }
  | { readonly ok: true; readonly exiting: false; readonly reason: 'live runs' | 'autopilot' | 'down' | 'unsupported' }
  | { readonly ok: false; readonly error: string };

export class FleetClient {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotJson = '';
  private readonly conn: RunnerConnection;
  private readonly history: RunHistory;

  constructor(private readonly opts: FleetClientOpts) {
    this.conn = new RunnerConnection(opts.runner, opts.log);
    this.history = new RunHistory(opts.root, opts.exec);
  }

  /** All runs plus the chain state, newest first; empty/null when no
   *  runner is alive (never throws, never spawns — the runner comes up
   *  on `start` only). */
  async runs(): Promise<readonly RunInfo[]> {
    try {
      if (!(await this.conn.adopt())) {
        // No daemon: the finished runs are still on disk, so their logs stay reachable.
        const history = await this.history.read();
        this.push({ runs: history, chain: null });
        return history;
      }
      const [data, chain] = await Promise.all([
        this.conn.get<{ runs: RunInfo[] }>('/status'),
        this.conn.get<ChainStatus>('/chain').catch(() => null),
      ]);
      this.push({ runs: data.runs, chain });
      this.startPolling();
      return data.runs;
    } catch {
      return [];
    }
  }

  private push(fleet: FleetSnapshot): void {
    const json = JSON.stringify(fleet);
    if (json === this.lastSnapshotJson) {
      return;
    }
    this.lastSnapshotJson = json;
    this.opts.onFleetChanged(fleet);
  }

  async start(request: RunRequest): Promise<StartOutcome> {
    if (!(await this.conn.ensure())) {
      return { ok: false, error: this.conn.downReason() };
    }
    return this.conn.post<StartOutcome>('/start', request);
  }

  async stop(runId: string, reason: string | null): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.conn.adopt())) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    return this.conn.post<{ ok: boolean; error?: string }>('/stop', { runId, reason });
  }

  /**
   * A message to a run (req-154): a chat with a worker is no Autopilot
   * matter, so the runner is started on demand when it is down — a
   * reopenable run resumes under the fresh runner. Its idle exit (req-110)
   * still applies once the run settles again.
   */
  async send(runId: string, text: string): Promise<{ ok: boolean; error?: string; rung?: string }> {
    if (!(await this.conn.ensure())) {
      return { ok: false, error: this.conn.downReason() };
    }
    return this.conn.post<{ ok: boolean; error?: string; rung?: string }>('/send', { runId, text });
  }

  /** A file for the takeover prompt: stored in the run's worktree, its path comes back. */
  async attach(runId: string, name: string, data: string): Promise<{ ok: boolean; error?: string; path?: string }> {
    if (!(await this.conn.adopt())) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    return this.conn.post<{ ok: boolean; error?: string; path?: string }>('/attach', { runId, name, data });
  }

  /** The owner's answer to a worker's pending approval (req-64). */
  async answerPermission(runId: string, decision: 'once' | 'always' | 'reject'): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.conn.adopt())) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    return this.conn.post<{ ok: boolean; error?: string }>('/permission', { runId, decision });
  }

  /** The owner's choices for a worker's question form (OpenCode's `question` tool). */
  async answerQuestion(runId: string, answers: QuestionAnswers): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.conn.adopt())) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    return this.conn.post<{ ok: boolean; error?: string }>('/answer', { runId, answers });
  }

  /** Takeover control of a live run: take over, interrupt the turn, hand back. */
  async control(
    action: 'takeover' | 'interrupt' | 'softpause' | 'release' | 'resume',
    runId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    // Resuming an ended run is the one control that may find no daemon
    // alive (the run is history): it brings one up, like a start does.
    const up = action === 'resume' ? await this.conn.ensure() : await this.conn.adopt();
    if (!up) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    return this.conn.post<{ ok: boolean; error?: string }>(`/${action}`, { runId });
  }

  /** The run's stream so far (the watch view's text), or null. */
  async stream(runId: string): Promise<string | null> {
    try {
      if (!(await this.conn.adopt())) {
        return await this.history.stream(runId);
      }
      const res = await fetch(`${this.conn.base()}/stream/${encodeURIComponent(runId)}`, {
        headers: this.conn.headers(),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  /** The daemon's recent log lines (the chain-log view), or null. */
  async log(): Promise<string | null> {
    try {
      if (!(await this.conn.adopt())) {
        return null;
      }
      const res = await fetch(`${this.conn.base()}/log`, { headers: this.conn.headers() });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  // --- the chain (M85, ADR-0077) -----------------------------------------

  /** The chain's control state, or null when no runner is alive. */
  async chainStatus(): Promise<ChainStatus | null> {
    try {
      if (await this.conn.adopt()) {
        return await this.conn.get<ChainStatus>('/chain');
      }
    } catch {
      // fall through
    }
    return null;
  }

  /** Points the runner at a tickets vault. Never spawns: a snapshot
   *  read must not bring a runner up; the next explicit interaction
   *  will. A configured chain re-points here when the board moves. */
  async configureChain(config: ChainConfig): Promise<void> {
    try {
      if (await this.conn.adopt()) {
        await this.conn.post('/chain/config', config);
      }
    } catch {
      // the runner is gone; the next start re-configures
    }
  }

  /** E14-5b: releases the agent claims of this host that no live run of the runner holds. */
  async releaseLeftoverClaims(
    store: ChainStoreConfig,
    retreat: Readonly<Record<string, string | null>>,
  ): Promise<{ readonly ok: true; readonly released: readonly string[]; readonly skipped: readonly { readonly id: string; readonly reason: string }[] } | { readonly ok: false; readonly error: string }> {
    if (!(await this.conn.ensure())) {
      return { ok: false, error: 'the fleet runner is not running' };
    }
    try {
      return await this.conn.post('/claims/release-leftovers', { dk: store, retreat });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async setMaster(mode: ChainMaster): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/master', { mode });
    } catch {
      return null;
    }
  }

  /**
   * The Autopilot switch (req-95). Re-reads the fleet right after, so every
   * device hears the change now — and starts the poll that carries the
   * runner's own later change (a resume time firing) to them.
   */
  async setAutopilot(record: AutopilotRecord): Promise<ChainStatus | AutopilotRefusal> {
    const reply = await this.conn.postWithWake<ChainStatus | AutopilotRefusal>('/chain/autopilot', record);
    if (!reply.ok) {
      // D-51: the refusal names why — the spawn failure, or what the request ran into.
      return { ok: false, error: reply.error, code: 'runner_down' };
    }
    await this.runs();
    return reply.value;
  }

  async setColumn(phase: string, mode: ColumnMode): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/column', { phase, mode });
    } catch {
      return null;
    }
  }

  async stopColumn(phase: string): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/column', { phase, stop: true });
    } catch {
      return null;
    }
  }

  /** req-181: "Allow today once" — the burn rate holds nothing more until the day turns. */
  async liftHold(): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/hold/lift', {});
    } catch {
      return null;
    }
  }

  /** Notaus: halt the chain and abort every live run. */
  async abortAll(): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/abort', {});
    } catch {
      return null;
    }
  }

  /** The persona pause (U4): a paused persona's tickets hold until played again. */
  async setPersonaPaused(persona: string, paused: boolean): Promise<ChainStatus | null> {
    if (!(await this.conn.ensure())) {
      return null;
    }
    try {
      return await this.conn.post<ChainStatus>('/chain/persona-pause', { persona, paused });
    } catch {
      return null;
    }
  }

  /**
   * Drey is gone (req-110): asks a live runner to leave if nothing needs it.
   * The runner decides — a live run or an On/Paused Autopilot keeps it and
   * the reply says why. Never spawns, never retires a stale build on the
   * way (that would spawn a successor to retire), and a runner from before
   * the route (404) is left alone: its idle span ends it.
   */
  async retireIfIdle(): Promise<RetireReply> {
    const peer = await this.conn.adoptAlive();
    if (peer === null) {
      return { ok: true, exiting: false, reason: 'down' };
    }
    try {
      const res = await fetch(`${this.conn.base()}/retire-if-idle`, { method: 'POST', headers: this.conn.headers() });
      if (res.status === 404) {
        this.opts.log('the fleet runner predates retire-if-idle — it leaves after its idle span', 'warn');
        return { ok: true, exiting: false, reason: 'unsupported' };
      }
      const body = (await res.json()) as { exiting?: unknown; reason?: unknown };
      if (body.exiting === true) {
        this.opts.log(`fleet runner retired (pid ${peer.pid}) — Drey closed and nothing is live`);
        this.conn.forget();
        return { ok: true, exiting: true };
      }
      const reason = body.reason === 'live runs' || body.reason === 'autopilot' ? body.reason : 'unsupported';
      this.opts.log(`fleet runner stays after Drey closed: ${reason}`);
      return { ok: true, exiting: false, reason };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- the slots (req-177, boards 7l and 7e) ---------------------------------

  /** Every slot with its windows, q, state and last fetch, or null when no runner is awake. Never wakes one. */
  async slots(): Promise<SlotsReply | null> {
    try {
      return (await this.conn.adopt()) ? await this.conn.get<SlotsReply>('/slots') : null;
    } catch {
      return null;
    }
  }

  /** Reads the quotas now (one slot, or all). */
  refreshSlots(id?: string): Promise<SlotsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<SlotsReply>('/slots/refresh', id === undefined ? {} : { id });
  }

  /** The owner signed the slot's account in again: it takes runs again. */
  slotLoginDone(id: string): Promise<{ readonly ok: true; readonly slot: SlotView | null } | { readonly ok: false; readonly error: string }> {
    return this.slotWrite('/slots/login-done', { id });
  }

  /** Writes the `slots` of `service.json` (every other key kept); a broken entry refuses the whole list. */
  writeSlots(slots: readonly unknown[]): Promise<SlotsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<SlotsReply>('/slots/config', { slots });
  }

  /** D-69: adds one slot entry to `service.json`, every other entry kept as written. */
  addSlot = (slot: unknown): Promise<SlotsReply | { readonly ok: false; readonly error: string }> => this.slotWrite<SlotsReply>('/slots/add', { slot });

  /** D-69: removes one slot — a configured entry, or an implied slot (its provider then has no slot here); req-287: `withModels` removes the model rows naming it too. */
  removeSlot = (id: string, withModels = false): Promise<SlotsReply | { readonly ok: false; readonly error: string }> => this.slotWrite<SlotsReply>('/slots/remove', withModels ? { id, withModels } : { id });

  /** req-287: changes one account's label, cost (`billing`) or sessions in place; a `null` removes the key. */
  updateSlot = (id: string, patch: Readonly<Record<string, unknown>>): Promise<SlotsReply | { readonly ok: false; readonly error: string }> => this.slotWrite<SlotsReply>('/slots/update', { id, patch });

  // --- the capacity pool (req-170, board 7l) ----------------------------------

  /** The model table, the caps, the ledger defaults, the live load and the queue; null when no runner is awake. Never wakes one. */
  async models(): Promise<ModelsReply | null> {
    try {
      return (await this.conn.adopt()) ? await this.conn.get<ModelsReply>('/models') : null;
    } catch {
      return null;
    }
  }

  /** Replaces the pool keys it is sent (req-287's `classes`, `models`, `capacity`, `ledgers`, req-178's `routing`) in `service.json`; a broken row refuses the write. */
  writeModels(keys: { readonly classes?: readonly unknown[]; readonly models?: readonly unknown[]; readonly capacity?: unknown; readonly ledgers?: unknown; readonly routing?: unknown }): Promise<ModelsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<ModelsReply>('/models/config', keys);
  }

  /** req-286: asks every harness what it offers (*Find models again*); `registry` also fills the capabilities from models.dev — one network call, only on the owner's ask. */
  discoverModels(registry: boolean): Promise<(ModelsReply & { readonly registryError?: string | null }) | { readonly ok: false; readonly error: string }> {
    return this.slotWrite('/models/discover', { registry });
  }

  /** req-286: takes a model the last check found into the table, under the class the card picked. */
  addDiscoveredModel(provider: string, model: string, cls: string): Promise<ModelsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<ModelsReply>('/models/add', { provider, model, class: cls });
  }

  /** req-286: keeps a found model's card away (`discovery.ignored`). */
  ignoreDiscoveredModel(provider: string, model: string): Promise<ModelsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<ModelsReply>('/models/ignore', { provider, model });
  }

  /** req-178: fills the model table's undeclared capability columns from models.dev — one network call, only on the owner's ask; the reply's `imported` says what. */
  importModelCapabilities(): Promise<ModelsReply | { readonly ok: false; readonly error: string }> {
    return this.slotWrite<ModelsReply>('/models/import', {});
  }

  private async slotWrite<T>(pathname: string, body: unknown): Promise<T | { readonly ok: false; readonly error: string }> {
    const reply = await this.conn.postWithWake<T>(pathname, body);
    return reply.ok ? reply.value : { ok: false, error: reply.error };
  }

  dispose(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Keeps the board's view of the fleet fresh for as long as the plugin
   * lives. The daemon dispatches on its own and can come and go (a build
   * change retires it, a restart brings it back), so a poll that only runs
   * while this client already knows of a live run misses exactly the runs
   * the owner wants to see: the board stayed idle while the log showed the
   * run. A poll round is one local request, and it pushes only on change.
   */
  startPolling(): void {
    if (this.pollTimer === null) {
      this.pollTimer = setInterval(() => void this.runs(), 2_500);
    }
  }


}
