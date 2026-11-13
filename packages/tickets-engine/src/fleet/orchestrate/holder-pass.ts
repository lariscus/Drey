import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { planHolderDispatch, type HolderCandidate, type HolderPlan, type PersonaPool } from '../holder-plan';
import type { ChainConfig, WorkerProviderId } from '../protocol';
import { LIVE_RUN_STATES } from '../run/run-state';
import type { BoardPersonas, HeldTicket, TicketPersona } from './board-personas';
import type { ChainState } from './chain-state';
import type { HoldRecorder } from './hold-recorder';
import type { PersonaBreaker } from './persona-breaker';
import type { SupervisorDirectory } from './supervisor-directory';
import type { WaitNotes } from './wait-notes';

export interface HolderPassDeps {
  readonly state: ChainState;
  readonly personas: BoardPersonas;
  readonly directory: SupervisorDirectory;
  readonly notes: WaitNotes;
  readonly breaker: PersonaBreaker;
  /** req-274: the cursor's moves as `hold` ledger lines; absent = none written. */
  readonly holds?: HoldRecorder;
}

/** What one pass on a chain board resolved: the holders and the agent holders' personas (what the dispatch loads). */
export interface HolderPassView {
  readonly held: ReadonlyMap<string, HeldTicket>;
  readonly entries: ReadonlyMap<string, TicketPersona>;
}

/** The plan's inputs the dispatcher counts. */
export interface HolderPassCounts {
  readonly busy: ReadonlySet<string>;
  readonly poolSize: Readonly<Partial<Record<WorkerProviderId, number>>>;
  readonly liveByPool: Readonly<Partial<Record<WorkerProviderId, number>>>;
  readonly poolOf: (card: TicketCard) => WorkerProviderId | null;
}

/**
 * The chain's side of a dispatch pass on a lifecycle store (req-257): who
 * holds each ticket (the holder rule over its chain and cursor), the plan
 * over the agent holders (`holder-plan.ts`: position order, the persona's
 * pool inside the big pool, its `min:` overrun, held and cooling personas
 * start nothing), and the wait line of every ticket that does not start —
 * no persona stands at You with the reason; a You entry waits for the
 * owner in Needs you and says nothing here.
 */
export class HolderPass {
  constructor(private readonly deps: HolderPassDeps) {}

  async resolve(config: ChainConfig, snap: BoardSnapshot): Promise<HolderPassView> {
    const held = await this.deps.personas.resolveHolders(config, snap);
    const entries = new Map<string, TicketPersona>();
    for (const [id, ticket] of held) {
      entries.set(id, ticket.entry);
    }
    return { held, entries };
  }

  /**
   * req-274: every ticket's holder to the hold record, each pass — the pass's own view while the
   * Autopilot runs (`view`), else the holders read for the record alone, so a move made while it is
   * off is still recorded at the pass that sees it.
   */
  async recordHolds(config: ChainConfig, snap: BoardSnapshot, view: HolderPassView | null): Promise<void> {
    const holds = this.deps.holds;
    if (holds === undefined) {
      return;
    }
    const holders = view !== null ? new Map([...view.held].map(([id, ticket]) => [id, ticket.holder])) : await this.deps.personas.holdersOf(config, snap);
    await holds.observe(holders);
  }

  plan(config: ChainConfig, snap: BoardSnapshot, view: HolderPassView, counts: HolderPassCounts): HolderPlan {
    const holders = new Map<string, HolderCandidate>();
    const pools = new Map<string, PersonaPool>();
    for (const [id, ticket] of view.held) {
      const persona = ticket.entry.persona;
      if (ticket.holder.kind === 'entry' && ticket.holder.work === 'run' && ticket.holder.entry.mode !== 'shape' && persona !== null) {
        holders.set(id, { persona: persona.id, position: ticket.holder.entry.position });
        const settings = persona.settings;
        pools.set(persona.id, { parallel: settings.parallel, min: settings.min });
      }
    }
    return planHolderDispatch({
      master: this.deps.state.master,
      columns: snap.columns,
      holders,
      poolSize: counts.poolSize,
      liveByPool: counts.liveByPool,
      poolOf: counts.poolOf,
      busyTickets: counts.busy,
      personaLive: this.personaLive(),
      personaPool: (persona) => pools.get(persona) ?? { parallel: null, min: 0 },
      heldPersonas: this.heldPersonas(holders),
      priorities: snap.priorities,
    });
  }

  /** The wait line of every chain ticket the pass did not start (said once per ticket and reason). */
  noteWaits(view: HolderPassView, plan: HolderPlan, started: ReadonlySet<string>): void {
    const { notes } = this.deps;
    this.clearWaits();
    for (const [id, ticket] of view.held) {
      if (started.has(id)) {
        continue;
      }
      const wait = plan.waits.get(id);
      if (wait?.why === 'persona-full') {
        this.deps.state.personaWaits[id] = wait.persona;
      }
      const line = this.waitLine(id, ticket, plan);
      if (line !== null) {
        notes.skip(id, line);
      }
    }
  }

  private waitLine(id: string, ticket: HeldTicket, plan: HolderPlan): string | null {
    const { holder } = ticket;
    if (holder.kind === 'no-persona') {
      return `${id} stands at You: ${holder.reason} — assign a persona or do it yourself`;
    }
    if (holder.kind !== 'entry') {
      return null; // a lifecycle column, or a question the owner answers in Needs you
    }
    const persona = holder.persona;
    const position = `position ${holder.entry.position} of ${holder.entry.length}`;
    if (holder.work === 'mission-turn') {
      return `${id} waits at ${position} for ${persona} — her Mission Control turn runs in the engine, no session here`;
    }
    if (holder.work !== 'run') {
      return null; // You's entry: the ticket waits for the owner in Needs you
    }
    if (holder.entry.mode === 'shape') {
      return `${id} waits at ${position} for the Shape chat with ${persona}`;
    }
    if (ticket.entry.persona === null) {
      return `${id} stands at ${position}: persona "${persona}" could not be read`;
    }
    return this.capacityLine(id, persona, plan);
  }

  private capacityLine(id: string, persona: string, plan: HolderPlan): string | null {
    const { state } = this.deps;
    const trip = state.personaTripped[persona];
    if (trip !== undefined) {
      return `dispatch holds ${id}: persona "${persona}" tripped the breaker (${trip.reason}) — play the persona again to release its tickets`;
    }
    if (state.pausedPersonas.has(persona)) {
      return `dispatch holds ${id}: persona "${persona}" is paused — play the persona again to release its tickets`;
    }
    if (this.deps.breaker.coolingDown(persona)) {
      return `dispatch waits ${id}: persona "${persona}" cools down after a red gate`;
    }
    const wait = plan.waits.get(id);
    if (wait?.why === 'persona-full') {
      return `dispatch waits ${id}: waits for ${persona} — the persona runs its maximum (parallel)`;
    }
    return wait?.why === 'pool-full' ? `dispatch waits ${id}: queued · no free slot in the pool` : null;
  }

  /** Live runs per persona — every run of it, the owner's included. */
  private personaLive(): Record<string, number> {
    const live: Record<string, number> = {};
    for (const { info } of this.deps.directory.all()) {
      const persona = info.persona ?? null;
      if (persona !== null && LIVE_RUN_STATES.includes(info.state)) {
        live[persona] = (live[persona] ?? 0) + 1;
      }
    }
    return live;
  }

  /** Forgets the last pass's persona waits (the Autopilot stopped, or a new pass begins). */
  clearWaits(): void {
    const waits = this.deps.state.personaWaits;
    for (const id of Object.keys(waits)) {
      delete waits[id];
    }
  }

  /** The personas that start nothing this pass: paused (the owner, the breaker) or cooling down. */
  private heldPersonas(holders: ReadonlyMap<string, HolderCandidate>): Set<string> {
    const held = new Set(this.deps.state.pausedPersonas);
    for (const { persona } of holders.values()) {
      if (this.deps.breaker.coolingDown(persona)) {
        held.add(persona);
      }
    }
    return held;
  }
}
