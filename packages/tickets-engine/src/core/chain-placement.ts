/**
 * Where a chain ticket stands on today's board (req-257, the owner's ruling
 * of 2026-11-12 on the persona board's interim): the board's columns stay
 * the pipeline's until req-270/271 draw holder columns, and an `active` /
 * `running` ticket's column is DERIVED from its holder — never stored (the
 * interim pin `x-phase` of req-265 retires with it):
 *
 * - the chain is through (the cursor past its last entry) -> the terminal
 *   column (the engine moves it to `done` right after);
 * - the holder is You (a You entry, a question, no persona) -> the owner's
 *   first checkpoint column (Ready to try), else the column before the
 *   terminal one;
 * - a `:shape` entry -> the queue column before the first agent column that
 *   is no lifecycle edge (Shaping), when the pipeline has one;
 * - an agent or Mission Control persona -> the first agent column whose
 *   `persona:` names it, else the first agent column;
 * - none of these exists (a pipeline of lifecycle columns only, after the
 *   live migration) -> null: the reader shows the stage itself as one
 *   "active" column.
 *
 * The same rule maps an owner's column move back onto the cursor
 * ({@link cursorForColumn}) and a migrated ticket's old column pin onto a
 * position ({@link cursorForPin}).
 */
import type { ChainEntry } from '../contracts/chain';
import { parseHandover, type PipelinePhase } from '../contracts/tickets';
import { holderOf, type HolderInput, type PersonaLookup, type TicketHolder } from './chain-holder';
import { EDGE_STAGES } from './lifecycle-stages';

/** True when the cursor stands past the chain's last entry: every entry is done. */
export function chainFinished(chain: readonly ChainEntry[] | undefined, at: number | undefined): boolean {
  return chain !== undefined && chain.length > 0 && (at ?? 1) > chain.length;
}

/** The pipeline facts the placement reads, derived once per board. */
export interface PlacementColumns {
  readonly terminal: string | null;
  /** The column You's entries stand in. */
  readonly owner: string | null;
  /** The column a `:shape` entry stands in; null = none (the agent rule decides). */
  readonly shape: string | null;
  /** The agent columns in pipeline order, with the persona each names. */
  readonly agents: readonly { readonly id: string; readonly persona: string | null }[];
}

/**
 * True when the column's handover hands tickets to an agent pool. Left for the board migration's
 * column -> cursor rule (`cursorForPin`, req-307 step 5): on a lifecycle-only pipeline no column is one.
 */
function isAutoPhase(phase: PipelinePhase): boolean {
  return parseHandover(phase.handover).mode === 'agent';
}

/** The owner's checkpoint columns: manual columns whose predecessor is automatic, or a checkpoint (see {@link isAutoPhase}). */
function checkpointPhaseIds(pipeline: readonly PipelinePhase[]): ReadonlySet<string> {
  const checkpoints = new Set<string>();
  for (let i = 1; i < pipeline.length; i++) {
    const phase = pipeline[i]!;
    if (!isAutoPhase(phase) && (isAutoPhase(pipeline[i - 1]!) || checkpoints.has(pipeline[i - 1]!.id))) {
      checkpoints.add(phase.id);
    }
  }
  return checkpoints;
}

/** The placement columns of a pipeline. */
export function placementColumnsOf(pipeline: readonly PipelinePhase[]): PlacementColumns {
  const checkpoints = checkpointPhaseIds(pipeline);
  const terminal = pipeline.length > 0 ? pipeline[pipeline.length - 1]!.id : null;
  const firstCheckpoint = pipeline.find((p) => checkpoints.has(p.id) && p.id !== terminal)?.id ?? null;
  const beforeTerminal = pipeline.length >= 2 ? pipeline[pipeline.length - 2]!.id : null;
  const firstAgent = pipeline.findIndex((p) => isAutoPhase(p));
  const queue = firstAgent < 0 ? [] : pipeline.slice(0, firstAgent).filter((p) => !EDGE_STAGES.includes(p.id));
  const agents = pipeline.filter((p) => isAutoPhase(p) && p.id !== terminal).map((p) => ({ id: p.id, persona: p.persona }));
  const owner = firstCheckpoint ?? (beforeTerminal !== null && !EDGE_STAGES.includes(beforeTerminal) && agents.every((a) => a.id !== beforeTerminal) ? beforeTerminal : null);
  return { terminal, owner, shape: queue.length > 0 ? queue[queue.length - 1]!.id : null, agents };
}

/** The column a holder stands in; null when the pipeline has none for it. */
export function columnOfHolder(holder: TicketHolder, columns: PlacementColumns): string | null {
  if (holder.kind === 'none') {
    return null;
  }
  if (holder.kind !== 'entry' || holder.work === 'owner') {
    return columns.owner;
  }
  if (holder.entry.mode === 'shape' && columns.shape !== null) {
    return columns.shape;
  }
  return columns.agents.find((a) => a.persona === holder.persona)?.id ?? columns.agents[0]?.id ?? null;
}

/** The column of an `active` / `running` chain ticket; null = the pipeline has no column for it. */
export function chainColumnOf(ticket: HolderInput, lookup: PersonaLookup, columns: PlacementColumns): string | null {
  if (chainFinished(ticket.chain, ticket.at)) {
    return columns.terminal;
  }
  return columnOfHolder(holderOf(ticket, lookup), columns);
}

/**
 * The cursor an owner's move into column `target` puts the ticket at: the
 * first position at or after the cursor that stands in that column (a
 * forward move — the owner hands the ticket on), else the nearest earlier
 * one (a move back). Null when no position of the chain stands there.
 */
export function cursorForColumn(input: { readonly chain: readonly ChainEntry[]; readonly at: number | undefined; readonly target: string }, lookup: PersonaLookup, columns: PlacementColumns): number | null {
  const { chain, target } = input;
  const from = Math.min(Math.max(input.at ?? 1, 1), chain.length);
  const standsIn = (position: number): boolean => chainColumnOf({ stage: 'active', chain, at: position, awaiting: undefined }, lookup, columns) === target;
  for (let position = from; position <= chain.length; position++) {
    if (standsIn(position)) {
      return position;
    }
  }
  for (let position = from - 1; position >= 1; position--) {
    if (standsIn(position)) {
      return position;
    }
  }
  return null;
}

/**
 * The position a ticket's old column pin stands for (concept §12 step 2, the
 * pins becoming cursors): Shaping -> the `:shape` entry; the owner's
 * checkpoint (Ready to try) -> the chain's last position You holds; a
 * working column -> the first position after the planning (the leading
 * entries of the `:shape` entry's persona — on the phase board one run of
 * the column planned AND built, so the build is what is left) that stands
 * in that column, else the first position after the planning.
 */
export function cursorForPin(chain: readonly ChainEntry[], pin: string, lookup: PersonaLookup, columns: PlacementColumns): number {
  if (chain.length === 0) {
    return 1;
  }
  const standsIn = (position: number): boolean => chainColumnOf({ stage: 'active', chain, at: position, awaiting: undefined }, lookup, columns) === pin;
  if (pin === columns.shape) {
    const shape = chain.findIndex((entry) => entry.mode === 'shape');
    return shape < 0 ? 1 : shape + 1;
  }
  if (pin === columns.owner) {
    for (let position = chain.length; position >= 1; position--) {
      if (standsIn(position)) {
        return position;
      }
    }
  }
  const afterPlan = firstAfterPlanning(chain);
  for (let position = afterPlan; position <= chain.length; position++) {
    if (standsIn(position)) {
      return position;
    }
  }
  return afterPlan;
}

/** The first position after the leading entries of the `:shape` entry's persona; 1 when the chain has no `:shape` entry. */
function firstAfterPlanning(chain: readonly ChainEntry[]): number {
  const shaper = chain.find((entry) => entry.mode === 'shape')?.persona ?? null;
  if (shaper === null) {
    return 1;
  }
  let position = 1;
  while (position <= chain.length && chain[position - 1]!.persona === shaper) {
    position += 1;
  }
  return Math.min(position, chain.length);
}
