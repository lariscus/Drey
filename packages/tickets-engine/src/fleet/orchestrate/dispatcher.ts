import type { BoardColumn, BoardSnapshot, PipelinePhase } from '../../contracts/tickets';
import { planDispatch } from '../chain';
import type { Clock } from '../ports/clock';
import { normalizeFleetPools, type ChainConfig, type ColumnMode, type WorkerProviderId } from '../protocol';
import { BLOCKING_RUN_STATES, LIVE_RUN_STATES } from '../run/run-state';
import type { BoardPersonas, TicketPersona } from './board-personas';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import type { HumanGates } from './human-gates';
import { messageOf } from './live-run';
import { PassPools } from './pass-pools';
import type { PoolCapacity } from './pool-capacity';
import type { SupervisorDirectory } from './supervisor-directory';
import type { TicketDispatch } from './ticket-dispatch';
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
}

/** What a pass found occupied: the live runs per pool and the tickets the plan must leave alone. */
interface Occupancy {
  readonly liveByPool: Record<WorkerProviderId, number>;
  readonly busy: Set<string>;
}

/**
 * One dispatch round (M85, ADR-0077): read the board, count the pools,
 * resolve the personas, park the human's gates, plan with the pure rules of
 * `chain.ts`, start what is due, and say why the rest waits.
 */
export class Dispatcher {
  private passing = false;

  constructor(private readonly deps: DispatcherDeps) {}

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
    const running = state.master === 'run';
    const personas = running ? await this.deps.personas.resolve(config, snap) : new Map<string, TicketPersona>();
    const paused = [...personas].filter(([, entry]) => entry.resolution.persona !== null && state.pausedPersonas.has(entry.resolution.persona));
    paused.forEach(([cardId]) => occupied.busy.add(cardId)); // U4: a paused persona's ticket is busy for this pass
    if (running) {
      await this.deps.humanGates.park(config, { snap, resolved: personas, busy: occupied.busy, modes });
    }
    const pools = new PassPools(config, snap, personas, this.deps.directory);
    const plan = planDispatch({
      master: state.master,
      columns: snap.columns,
      modes,
      poolSize: this.deps.pools.sizes(config),
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
    const refusedByColumn = new Map<string, string>();
    for (const item of plan) {
      const outcome = await this.deps.dispatch.dispatch(config, snap, { card: item.card, workingPhaseId: item.workingPhase, persona: personas.get(item.card.id) ?? null, modelChoice: pools.choiceOf(item.card.id) });
      if (outcome === 'refused' && !refusedByColumn.has(item.workingPhase)) {
        refusedByColumn.set(item.workingPhase, item.card.id);
      }
    }
    this.noteWaits(snap, pools, { busy: occupied.busy, dispatched: new Set(plan.map((item) => item.card.id)), refusedByColumn });
    this.deps.notes.endPass();
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
