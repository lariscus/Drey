import type { BoardColumn, BoardSnapshot, PipelinePhase } from '../../contracts/tickets';
import { planDispatch, type PlannedDispatch as PlanItem } from '../chain';
import type { Clock } from '../ports/clock';
import { normalizeFleetPools, type ChainConfig, type ClassRequest, type ColumnMode, type PoolWaitDecision, type WorkerProviderId } from '../protocol';
import { BLOCKING_RUN_STATES, LIVE_RUN_STATES } from '../run/run-state';
import type { BoardPersonas, TicketPersona } from './board-personas';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import { ClassRequestBuilder } from './class-request-builder';
import type { DispatchPool } from './dispatch-pool';
import type { HumanGates } from './human-gates';
import type { LedgerCards } from './ledger-cards';
import { messageOf } from './live-run';
import { PassPools } from './pass-pools';
import type { PoolCapacity } from './pool-capacity';
import type { StartHold } from './start-hold';
import type { SupervisorDirectory } from './supervisor-directory';
import type { DispatchOutcome, PoolGrantFor, TicketDispatch } from './ticket-dispatch';
import type { WaitContext } from './wait-lines';
import type { WaitNotes } from './wait-notes';

export interface DispatcherDeps {
  readonly state: ChainState;
  readonly board: ChainBoard;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
  readonly personas: BoardPersonas;
  readonly humanGates: HumanGates;
  readonly dispatch: TicketDispatch;
  readonly notes: WaitNotes;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The pass read the pipeline: drop stale phase state and write `chain.json`. */
  readonly pipelineRead: () => Promise<void>;
  readonly persist: () => Promise<void>;
  /** req-170: the capacity pool every persona dispatch asks for its class; absent = no class requests. */
  readonly pool?: DispatchPool;
  /** req-170: the Needs-you card of a full ledger. */
  readonly ledgerCards?: LedgerCards;
  /** req-179: the tranche's release gate; absent = every start is released. */
  readonly tranches?: TrancheGate;
  /** req-181: the burn rate's hold over every new start; absent = nothing holds. */
  readonly hold?: StartHold;
}

/** The tranche as the dispatch sees it (req-179): may a start go, count one, raise a checkpoint the clock reached. */
export interface TrancheGate {
  mayStart(): boolean;
  started(ticket: string): void;
  review(): boolean;
}

/** What a pass found occupied: the live runs per pool and the tickets the plan must leave alone. */
interface Occupancy {
  readonly liveByPool: Record<WorkerProviderId, number>;
  readonly busy: Set<string>;
}

/** What one pass dispatches over. */
interface Pass {
  readonly plan: readonly PlanItem[];
  readonly personas: ReadonlyMap<string, TicketPersona>;
  readonly pools: PassPools;
  /** req-181: the burn rate holds every new start this pass. */
  readonly held: boolean;
}

/** A plan item's class request and the pool's answer. */
interface Asked {
  readonly request: ClassRequest;
  readonly grant: PoolGrantFor | null;
  readonly wait: PoolWaitDecision | null;
}

/**
 * One dispatch round (M85, ADR-0077): read the board, count the pools,
 * resolve the personas, park the human's gates, plan with the pure rules of
 * `chain.ts`, ask the capacity pool for each persona's class (req-170),
 * start what it grants, and say why the rest waits.
 */
export class Dispatcher {
  private passing = false;
  private readonly classes: ClassRequestBuilder | null;

  constructor(private readonly deps: DispatcherDeps) {
    this.classes = deps.pool === undefined ? null : new ClassRequestBuilder(deps.pool.classes);
  }

  async pass(): Promise<void> {
    const config = this.deps.state.config;
    if (config === null || this.passing) {
      return;
    }
    this.passing = true;
    try {
      const read = await this.deps.board.read(config);
      const snap = read === null ? null : await this.deps.board.settleLeftovers(config, read);
      if (snap !== null && snap.pipeline.length > 0) {
        await this.run(config, snap);
      }
    } catch (error) {
      this.deps.log(`dispatch pass failed: ${messageOf(error)}`);
    } finally {
      this.passing = false;
    }
  }

  private async run(config: ChainConfig, snap: BoardSnapshot): Promise<void> {
    const { state } = this.deps;
    const occupied = this.occupancy();
    this.holdFailingAndStopped(snap.columns, occupied.busy);
    const modes = this.modesWithBudget(snap.pipeline);
    await this.deps.pools.refreshProbes(config.pools ?? normalizeFleetPools(undefined));
    if (this.deps.tranches?.review() === true) {
      await this.deps.persist(); // req-179: the time span ran out — the checkpoint pauses the Autopilot before planning
    }
    const running = state.master === 'run';
    const personas = running ? await this.deps.personas.resolve(config, snap) : new Map<string, TicketPersona>();
    const paused = [...personas].filter(([, entry]) => entry.resolution.persona !== null && state.pausedPersonas.has(entry.resolution.persona));
    paused.forEach(([cardId]) => occupied.busy.add(cardId)); // U4: a paused persona's ticket is busy for this pass
    if (running) {
      await this.deps.humanGates.park(config, { snap, resolved: personas, busy: occupied.busy, modes });
    }
    const pools = new PassPools(config, snap, personas, this.deps.pool !== undefined);
    const plan = planDispatch({
      master: state.master,
      columns: snap.columns,
      modes,
      poolSize: this.deps.pools.sizes(config, this.sessionsOf()),
      liveByPool: occupied.liveByPool,
      poolOf: pools.poolOf,
      busyTickets: occupied.busy,
      cooldownUntil: state.cooldownUntil,
      nowMs: this.deps.clock.now().getTime(),
      priorities: snap.priorities, // the dispatch classes split at the vault's own vocabulary
    });
    state.phases = snap.pipeline;
    await this.deps.pipelineRead();
    this.deps.notes.beginPass();
    for (const [cardId, entry] of paused) {
      this.deps.notes.skip(cardId, `dispatch holds ${cardId}: persona "${entry.resolution.persona}" is paused — play the persona again to release its tickets`);
    }
    const held = running && (this.deps.hold?.current() ?? null) !== null; // req-181: asked once per pass, before any start
    const refusedByColumn = await this.dispatchPlan(config, snap, { plan, personas, pools, held });
    this.noteWaits(snap, pools, { busy: occupied.busy, dispatched: new Set(plan.map((item) => item.card.id)), refusedByColumn });
    this.deps.notes.endPass();
  }

  /** The plan's bound per provider: its slots' sessions with the pool, the plugin's pool sizes without. */
  private sessionsOf(): ((provider: WorkerProviderId) => number | null) | undefined {
    const pool = this.deps.pool;
    return pool === undefined ? undefined : (provider) => pool.sessionsOf(provider);
  }

  /** Starts what the plan holds, in its order; a persona's class request waits when the pool has no room (no process). */
  private async dispatchPlan(config: ChainConfig, snap: BoardSnapshot, pass: Pass): Promise<Map<string, string>> {
    const refusedByColumn = new Map<string, string>();
    this.deps.pool?.queue.begin();
    for (const item of pass.plan) {
      const outcome = await this.dispatchOne(config, snap, item, pass);
      if (outcome === 'refused' && !refusedByColumn.has(item.workingPhase)) {
        refusedByColumn.set(item.workingPhase, item.card.id);
      }
    }
    this.deps.pool?.queue.end();
    return refusedByColumn;
  }

  /** One plan item through the burn rate's hold (req-181) and the tranche's release gate (req-179); a start counts against the tranche. */
  private async dispatchOne(config: ChainConfig, snap: BoardSnapshot, item: PlanItem, pass: Pass): Promise<DispatchOutcome | 'queued'> {
    const tranches = this.deps.tranches;
    if (pass.held) {
      return 'skipped'; // req-181: the burn rate is reached — nothing new starts until the day turns
    }
    if (tranches !== undefined && !tranches.mayStart()) {
      return 'skipped'; // req-179: the tranche is spent or a checkpoint waits — nothing new starts
    }
    const outcome = await this.askAndStart(config, snap, item, pass);
    if (outcome === 'dispatched' && tranches !== undefined) {
      tranches.started(item.card.id);
      await this.deps.persist();
    }
    return outcome;
  }

  /** The class request first (a wait queues it), then the start; a granted ticket's ledger cards resolve. */
  private async askAndStart(config: ChainConfig, snap: BoardSnapshot, item: PlanItem, pass: Pass): Promise<DispatchOutcome | 'queued'> {
    const persona = pass.personas.get(item.card.id) ?? null;
    const asked = pass.pools.asksPool(item.card) ? this.ask(snap, item, persona) : null;
    if (asked !== null && asked.wait !== null) {
      await this.queued(config, item, asked.request, asked.wait);
      return 'queued';
    }
    const outcome = await this.deps.dispatch.dispatch(config, snap, { card: item.card, workingPhaseId: item.workingPhase, persona, grant: asked?.grant ?? null });
    if (outcome === 'dispatched' && asked !== null) {
      await this.deps.ledgerCards?.resolve(config, item.card.id);
    }
    return outcome;
  }

  /** The class request of a persona's dispatch and the pool's answer; null when it cannot be built. */
  private ask(snap: BoardSnapshot, item: PlanItem, entry: TicketPersona | null): Asked | null {
    const phase = snap.pipeline.find((p) => p.id === item.workingPhase) ?? null;
    const persona = entry?.persona ?? null;
    if (this.classes === null || this.deps.pool === undefined || phase === null || persona === null) {
      return null;
    }
    const repo = item.card.meta.repo === null ? null : (snap.repos.find((r) => r.name === item.card.meta.repo) ?? null);
    const request = this.classes.build({ card: item.card, phase, persona, repo, prefer: this.lastSlotOf(item.card.id) });
    const decision = this.deps.pool.classes.choose(request);
    return decision.kind === 'grant' ? { request, grant: { request, decision }, wait: null } : { request, grant: null, wait: decision };
  }

  /** req-178: the slot of the ticket's latest run — the start's gate prefers it too, so a resumable session stays on its account. */
  private lastSlotOf(ticket: string): string | null {
    let latest: { readonly startedAt: string; readonly slot?: { readonly id: string } } | null = null;
    for (const { info } of this.deps.directory.all()) {
      if (info.ticketId === ticket && info.slot !== undefined && (latest === null || info.startedAt > latest.startedAt)) {
        latest = info;
      }
    }
    return latest?.slot?.id ?? null;
  }

  /** No room for the class: the task queues — the card's line, the log once, a ledger's Needs-you card. */
  private async queued(config: ChainConfig, item: PlanItem, request: ClassRequest, wait: PoolWaitDecision): Promise<void> {
    this.deps.pool?.queue.wait({ ticket: item.card.id, persona: request.persona, class: request.class, reason: wait.reason, line: wait.line, detail: wait.detail });
    this.deps.notes.skip(item.card.id, `dispatch waits ${item.card.id}: queued · ${wait.line} — ${wait.detail} (asked ${request.class ?? 'a pinned model'}: ${request.why})`);
    if (wait.ledger !== undefined) {
      await this.deps.ledgerCards?.raise(config, item.card.id, wait.ledger);
    }
  }

  /** A worker waiting on the owner takes no pool slot (a pool of one used to block on one question); its ticket stays busy. */
  private occupancy(): Occupancy {
    const liveByPool: Record<WorkerProviderId, number> = { opencode: 0, 'claude-code': 0, kimi: 0 };
    const busy = new Set<string>();
    for (const record of this.deps.directory.all()) {
      if (LIVE_RUN_STATES.includes(record.info.state) && record.info.waiting == null) {
        liveByPool[record.info.provider] += 1;
      }
      if (BLOCKING_RUN_STATES.includes(record.info.state)) {
        busy.add(record.info.ticketId);
      }
    }
    return { liveByPool, busy };
  }

  private noteWaits(snap: BoardSnapshot, pools: PassPools, pass: Pick<WaitContext, 'busy' | 'dispatched' | 'refusedByColumn'>): void {
    if (this.deps.state.master !== 'run') {
      this.deps.pool?.queue.clear();
      return; // the chain is off — silence is the honest state
    }
    const detached = new Set(this.deps.directory.all().filter((r) => r.info.state === 'detached').map((r) => r.info.ticketId));
    const ownerHeld = new Set(Object.keys(this.deps.state.ownerHold));
    this.deps.notes.waits(snap, (phaseId) => this.deps.state.modeOf(phaseId), { ...pass, detached, ownerHeld, poolOf: pools.poolOf });
  }

  /** Tickets backing off after failed runs, and those whose run the owner stopped (released once moved or restarted). */
  private holdFailingAndStopped(columns: readonly BoardColumn[], busy: Set<string>): void {
    const { state } = this.deps;
    const nowMs = this.deps.clock.now().getTime();
    const phaseOf = new Map(columns.flatMap((column) => column.tickets.map((card) => [card.id, card.phase] as const)));
    for (const [ticket, failure] of Object.entries(state.ticketFailures)) {
      if (nowMs < Date.parse(failure.until)) {
        busy.add(ticket);
      }
    }
    let released = false;
    for (const [ticket, hold] of Object.entries(state.ownerHold)) {
      const restarted = this.deps.directory.all().some((r) => r.info.ticketId === ticket && Date.parse(r.info.startedAt) > Date.parse(hold.at));
      if (phaseOf.get(ticket) !== hold.phase || restarted) {
        delete state.ownerHold[ticket];
        released = true;
      } else {
        busy.add(ticket);
      }
    }
    if (released) {
      void this.deps.persist();
    }
  }

  /** A spent daily token budget reads as held at dispatch — it used to be checked only after a red gate. */
  private modesWithBudget(pipeline: readonly PipelinePhase[]): Record<string, ColumnMode> {
    const { state } = this.deps;
    const modes: Record<string, ColumnMode> = { ...state.columns };
    const day = this.deps.clock.now().toISOString().slice(0, 10);
    for (const phase of pipeline) {
      const budget = phase.tokenBudget ?? 0;
      if (budget > 0 && state.tokensDay[phase.id] === day && (state.tokensUsed[phase.id] ?? 0) > budget) {
        if (state.modeOf(phase.id) === 'playing') {
          this.deps.notes.budget(`${phase.id} holds: the daily token budget is spent (${state.tokensUsed[phase.id]} of ${budget})`);
        }
        modes[phase.id] = 'held';
      }
    }
    return modes;
  }
}
