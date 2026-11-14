/**
 * The chain's dispatch plan on a lifecycle store (req-257, the persona
 * board concept §9). Pure — the dispatcher feeds it the board, the holders
 * of this pass and the live counts.
 *
 * - A candidate is a dispatchable ticket whose holder is an agent persona
 *   that runs (no `:shape` entry — that one is the owner's Shape chat; no
 *   held or cooling persona).
 * - Order: priority class first (unchanged), then *finishing beats
 *   starting* by the cursor's position (later positions first), then the
 *   board's rank.
 * - Room: a run needs a free place in the BIG pool (its provider's slots)
 *   AND in its persona's pool (`parallel:`, absent = no cap). A persona
 *   with `min: n` and fewer than n runs starts one even when the big pool
 *   is full — an overrun on purpose (default 0: nothing exceeds the pool).
 */
import { DEFAULT_PRIORITY_CONFIG, priorityClass, type BoardColumn, type PipelinePhase, type PriorityConfig, type TicketCard } from '../contracts/tickets';
import { pipelinePhaseOf } from '../core/pipeline-phase';
import { dispatchable } from './chain';
import { WORKER_PROVIDERS, type ChainMaster, type WorkerProviderId } from './protocol';

/** One ticket the pass found held by an agent persona that runs. */
export interface HolderCandidate {
  readonly persona: string;
  /** The cursor's position — what finishing-beats-starting orders by. */
  readonly position: number;
}

/** A persona's own pool (concept §9). */
export interface PersonaPool {
  /** Its maximum of parallel runs; null = no cap. */
  readonly parallel: number | null;
  /** Runs it may start beyond the big pool while it has fewer than this. */
  readonly min: number;
}

export interface HolderPlanInput {
  readonly master: ChainMaster;
  readonly columns: readonly BoardColumn[];
  /** The agent holders of this pass by ticket id; a ticket absent here is nobody's run. */
  readonly holders: ReadonlyMap<string, HolderCandidate>;
  readonly poolSize: Readonly<Partial<Record<WorkerProviderId, number>>>;
  readonly liveByPool: Readonly<Partial<Record<WorkerProviderId, number>>>;
  /** The provider the persona's run takes a slot of; null = unresolvable (planned without one, the start refuses it). */
  readonly poolOf: (card: TicketCard) => WorkerProviderId | null;
  readonly busyTickets: ReadonlySet<string>;
  /** Live runs per persona (every run of it, the owner's included). */
  readonly personaLive: Readonly<Record<string, number>>;
  readonly personaPool: (persona: string) => PersonaPool;
  /** Personas that start nothing this pass (paused by the owner, tripped, cooling down). */
  readonly heldPersonas: ReadonlySet<string>;
  readonly priorities?: PriorityConfig;
}

export interface PlannedHolderDispatch {
  readonly card: TicketCard;
  /** The column the ticket stands in (its holder's) — the run's working column. */
  readonly workingPhase: string;
  readonly fromPhase: string;
  readonly pool: WorkerProviderId | null;
  readonly persona: string;
  readonly position: number;
  /** True when the start overruns the big pool on the persona's `min:`. */
  readonly overrun: boolean;
}

/** Why a candidate did not get a place this pass (the wait line's reason). */
export type HolderWait = 'persona-full' | 'pool-full';

export interface HolderPlan {
  readonly plan: readonly PlannedHolderDispatch[];
  /** Candidates left without a place, by ticket id. */
  readonly waits: ReadonlyMap<string, { readonly persona: string; readonly why: HolderWait }>;
  /** req-148: every candidate's ticket id in dispatch order — the order the dispatcher's queue is reported in. */
  readonly order: readonly string[];
}

interface Candidate {
  readonly card: TicketCard;
  readonly column: string;
  readonly held: HolderCandidate;
}

/** What to start right now, in dispatch order (see the module comment). */
export function planHolderDispatch(input: HolderPlanInput): HolderPlan {
  if (input.master !== 'run') {
    return { plan: [], waits: new Map(), order: [] };
  }
  return assignPlaces(input, sortedCandidates(input));
}

function sortedCandidates(input: HolderPlanInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const column of input.columns) {
    for (const card of column.tickets) {
      const held = input.holders.get(card.id);
      if (held !== undefined && !input.heldPersonas.has(held.persona) && dispatchable(card, input.busyTickets)) {
        candidates.push({ card, column: column.phase.id, held });
      }
    }
  }
  const priorities = input.priorities ?? DEFAULT_PRIORITY_CONFIG;
  return candidates.sort(
    (a, b) =>
      priorityClass(a.card.meta.priority, priorities) - priorityClass(b.card.meta.priority, priorities) ||
      b.held.position - a.held.position ||
      a.card.meta.rank - b.card.meta.rank,
  );
}

function assignPlaces(input: HolderPlanInput, candidates: readonly Candidate[]): HolderPlan {
  const free: Record<WorkerProviderId, number> = { opencode: 0, 'claude-code': 0, kimi: 0, copilot: 0 };
  for (const provider of WORKER_PROVIDERS) {
    free[provider] = (input.poolSize[provider] ?? 0) - (input.liveByPool[provider] ?? 0);
  }
  const running: Record<string, number> = { ...input.personaLive };
  const plan: PlannedHolderDispatch[] = [];
  const waits = new Map<string, { persona: string; why: HolderWait }>();
  for (const { card, column, held } of candidates) {
    const pool = input.poolOf(card);
    const place = placeOf(input.personaPool(held.persona), running[held.persona] ?? 0, pool === null || free[pool] > 0);
    if (place.kind === 'wait') {
      waits.set(card.id, { persona: held.persona, why: place.why });
      continue;
    }
    if (pool !== null && !place.overrun) {
      free[pool] -= 1;
    }
    running[held.persona] = (running[held.persona] ?? 0) + 1;
    plan.push({ card, workingPhase: column, fromPhase: card.phase, pool, persona: held.persona, position: held.position, overrun: place.overrun });
  }
  return { plan, waits, order: candidates.map((candidate) => candidate.card.id) };
}

/** One candidate's place: its persona's pool first, then the big pool, the persona's min overrunning a full one. */
function placeOf(own: PersonaPool, count: number, room: boolean): { readonly kind: 'start'; readonly overrun: boolean } | { readonly kind: 'wait'; readonly why: HolderWait } {
  if (own.parallel !== null && count >= own.parallel) {
    return { kind: 'wait', why: 'persona-full' };
  }
  if (room) {
    return { kind: 'start', overrun: false };
  }
  return count < own.min ? { kind: 'start', overrun: true } : { kind: 'wait', why: 'pool-full' };
}

/**
 * The working column of a chain run: the pipeline column the ticket stands in, else (a pipeline of
 * lifecycle columns only, the stage shown as its own column) a plain agent column of that id — the
 * persona's settings carry what the column's keys used to (req-258).
 */
export function chainWorkingPhase(pipeline: readonly PipelinePhase[], id: string): PipelinePhase {
  return pipeline.find((p) => p.id === id) ?? pipelinePhaseOf({ title: 'Active', claim: true, handover: 'agent' }, id, []);
}
