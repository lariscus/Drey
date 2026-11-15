import type { BoardColumn, BoardSnapshot } from '../../contracts/tickets';
import { chainWorkingPhase, type PlannedHolderDispatch as PlanItem } from '../holder-plan';
import type { Clock } from '../ports/clock';
import { normalizeFleetPools, type ChainConfig, type ClassRequest, type PoolWaitDecision, type WorkerProviderId } from '../protocol';
import { BLOCKING_RUN_STATES, LIVE_RUN_STATES } from '../run/run-state';
import type { TicketPersona } from './board-personas';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import { ClassRequestBuilder } from './class-request-builder';
import type { DispatchPool } from './dispatch-pool';
import type { HolderPass, HolderPassView } from './holder-pass';
import type { LedgerCards } from './ledger-cards';
import { messageOf } from './live-run';
import { PassPools } from './pass-pools';
import type { PoolCapacity } from './pool-capacity';
import { reportQueue } from './queue-report';
import type { StartHold } from './start-hold';
import type { SupervisorDirectory } from './supervisor-directory';
import type { DispatchOutcome, PoolGrantFor, TicketDispatch } from './ticket-dispatch';
import type { WaitNotes } from './wait-notes';

export interface DispatcherDeps {
  readonly state: ChainState;
  readonly board: ChainBoard;
  readonly directory: SupervisorDirectory;
  readonly pools: PoolCapacity;
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
  /** req-257: the chain's pass — the dispatch by holder. */
  readonly holders: HolderPass;
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
 * One dispatch round (M85, ADR-0077, req-257): read the board, count the
 * pools, resolve the holders, plan with the pure rules of `holder-plan.ts`,
 * ask the capacity pool for each persona's class (req-170), start what it
 * grants, and say why the rest waits.
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

  /** What every pass counts first: the occupancy, the holds, the probes, a due tranche checkpoint. */
  private async prepare(config: ChainConfig, snap: BoardSnapshot): Promise<Occupancy> {
    const occupied = this.occupancy();
    this.holdFailingAndStopped(snap.columns, occupied.busy);
    await this.deps.pools.refreshProbes(config.pools ?? normalizeFleetPools(undefined));
    if (this.deps.tranches?.review() === true) {
      await this.deps.persist(); // req-179: the time span ran out — the checkpoint pauses the Autopilot before planning
    }
    return occupied;
  }

  /**
   * req-257: the pass — the holders: the chain's plan (position order, the persona's pool, its min
   * overrun), the starts through the pool and the tranche, and the holders' wait lines. No human gate
   * parks here: a You entry is the owner's in Needs you.
   */
  private async run(config: ChainConfig, snap: BoardSnapshot): Promise<void> {
    const { state, holders } = this.deps;
    const occupied = await this.prepare(config, snap);
    const running = state.master === 'run';
    const view: HolderPassView = running ? await holders.resolve(config, snap) : { held: new Map(), entries: new Map() };
    await holders.recordHolds(config, snap, running ? view : null); // req-274: the cursor's moves as `hold` lines
    const pools = new PassPools(config, snap, view.entries, this.deps.pool !== undefined);
    const planned = holders.plan(config, snap, view, {
      busy: occupied.busy,
      poolSize: this.deps.pools.sizes(config, this.sessionsOf()),
      liveByPool: occupied.liveByPool,
      poolOf: (card) => pools.poolOf(card),
    });
    state.phases = snap.pipeline;
    await this.deps.pipelineRead();
    this.deps.notes.beginPass();
    const held = running && (this.deps.hold?.current() ?? null) !== null;
    await this.dispatchPlan(config, snap, { plan: planned.plan, personas: view.entries, pools, held });
    if (running) {
      holders.noteWaits(view, planned, new Set(planned.plan.map((item) => item.card.id)));
    } else {
      this.deps.pool?.queue.clear();
      holders.clearWaits();
    }
    reportQueue(state, this.deps, { order: planned.order, waits: running ? planned.waits : new Map() }); // req-148
    this.deps.notes.endPass();
  }

  /** The plan's bound per provider: its slots' sessions with the pool, the plugin's pool sizes without. */
  private sessionsOf(): ((provider: WorkerProviderId) => number | null) | undefined {
    const pool = this.deps.pool;
    return pool === undefined ? undefined : (provider) => pool.sessionsOf(provider);
  }

  /** Starts what the plan holds, in its order; a persona's class request waits when the pool has no room (no process). */
  private async dispatchPlan(config: ChainConfig, snap: BoardSnapshot, pass: Pass): Promise<void> {
    this.deps.pool?.queue.begin();
    for (const item of pass.plan) {
      await this.dispatchOne(config, snap, item, pass);
    }
    this.deps.pool?.queue.end();
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
    const asked = pass.pools.asksPool(item.card) ? this.ask(item, persona) : null;
    // req-257: a persona below its `min:` starts even when the pool has no room — an overrun on purpose.
    if (asked !== null && asked.wait !== null && !item.overrun) {
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
  private ask(item: PlanItem, entry: TicketPersona | null): Asked | null {
    const persona = entry?.persona ?? null;
    if (this.classes === null || this.deps.pool === undefined || persona === null) {
      return null;
    }
    const request = this.classes.build({ card: item.card, persona, prefer: this.lastSlotOf(item.card.id) });
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
    const liveByPool: Record<WorkerProviderId, number> = { opencode: 0, 'claude-code': 0, kimi: 0, copilot: 0 };
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
}
