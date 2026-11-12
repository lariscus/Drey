/**
 * The holder rule (req-257, the persona board concept §3): who holds a
 * ticket, DERIVED from its stage, its chain and its cursor — never stored.
 * One function, used by the runner and by every surface:
 *
 *  1. the stage is a lifecycle edge (`inbox`, `prioritized`, `done`, and
 *     dricket's `cancelled`) -> no holder; the lifecycle column;
 *  2. `awaiting: you` -> You (a question inside a run, a ticket the owner
 *     must decide); the card names the persona the entry belongs to;
 *  3. the entry at the cursor names no readable persona (deleted,
 *     misspelled, a chain that did not parse) -> You, with *no persona for
 *     position n*;
 *  4. otherwise the persona of the entry (`you` is the human persona).
 *
 * What happens at the holder is `entryWorkOf` of its persona: a run, a
 * Mission Control turn, or the owner's step.
 */
import type { ChainEntry, ChainMode } from '../contracts/chain';
import { entryWorkOf, type ChainEntryWork } from './chain-entry-work';
import { EDGE_STAGES } from './lifecycle-stages';
import { HUMAN_PERSONA_ID, type Persona } from './persona';

/** What the rule reads of a ticket. */
export interface HolderInput {
  /** The store's lifecycle stage (`inbox` … `done`, `active`, `running`). */
  readonly stage: string;
  readonly chain: readonly ChainEntry[] | undefined;
  /** The cursor, 1-based; absent = 1. */
  readonly at: number | undefined;
  /** `awaiting:` — a persona id the ticket waits for (today only ever `you`). */
  readonly awaiting: string | undefined;
}

/** A persona looked up by id; null = no readable persona of that id. */
export type PersonaLookup = (id: string) => Pick<Persona, 'id' | 'kind'> | null;

/** The entry the holder works: its position and what the chain says there. */
export interface HeldEntry {
  readonly position: number;
  /** The chain's length — `position of length` on the card. */
  readonly length: number;
  /** The persona id the entry names (as written; null when the chain has no entry there). */
  readonly named: string | null;
  readonly mode: ChainMode | null;
  readonly notify: boolean;
}

export type TicketHolder =
  /** Rule 1: a lifecycle column, no holder. */
  | { readonly kind: 'none' }
  /** Rule 2: the ticket waits for the owner; `entry` is the position it waits at. */
  | { readonly kind: 'awaiting'; readonly persona: typeof HUMAN_PERSONA_ID; readonly entry: HeldEntry | null }
  /** Rule 3: no readable persona at the cursor — the ticket stands at You with the reason. */
  | { readonly kind: 'no-persona'; readonly persona: typeof HUMAN_PERSONA_ID; readonly entry: HeldEntry | null; readonly reason: string }
  /** Rule 4: the entry's persona holds it; `work` says what happens there. */
  | { readonly kind: 'entry'; readonly persona: string; readonly entry: HeldEntry; readonly work: Exclude<ChainEntryWork, 'missing'> };

const LIFECYCLE_EDGES: readonly string[] = [...EDGE_STAGES, 'cancelled'];

/** The entry at the cursor, clamped to the chain; null when the chain is absent or empty. */
export function entryAtCursor(chain: readonly ChainEntry[] | undefined, at: number | undefined): HeldEntry | null {
  if (chain === undefined || chain.length === 0) {
    return null;
  }
  const position = Math.min(Math.max(at ?? 1, 1), chain.length);
  const entry = chain[position - 1]!;
  return { position, length: chain.length, named: entry.persona, mode: entry.mode, notify: entry.notify };
}

/** The reason a ticket stands at You for want of a persona — the card's line and the wait note. */
export function noPersonaReason(entry: HeldEntry | null): string {
  if (entry === null) {
    return 'the ticket has no chain — no persona to take it';
  }
  return `no persona for position ${entry.position}${entry.named !== null ? ` ("${entry.named}" is not in the crew)` : ''}`;
}

/** Who holds the ticket (concept §3) — see the module comment for the four rules. */
export function holderOf(ticket: HolderInput, lookup: PersonaLookup): TicketHolder {
  if (LIFECYCLE_EDGES.includes(ticket.stage)) {
    return { kind: 'none' };
  }
  const entry = entryAtCursor(ticket.chain, ticket.at);
  if (ticket.awaiting === HUMAN_PERSONA_ID) {
    return { kind: 'awaiting', persona: HUMAN_PERSONA_ID, entry };
  }
  const persona = entry === null || entry.named === null ? null : lookup(entry.named);
  const work = entryWorkOf(persona);
  if (entry === null || persona === null || work === 'missing') {
    return { kind: 'no-persona', persona: HUMAN_PERSONA_ID, entry, reason: noPersonaReason(entry) };
  }
  return { kind: 'entry', persona: persona.id, entry, work };
}

/**
 * A lookup over the crew's kinds (persona id -> kind). Without a crew read
 * (`kinds` absent) every named persona counts as readable: `you` is the
 * human persona, `pia` Mission Control's, anyone else an agent.
 */
export function crewLookupOf(kinds: ReadonlyMap<string, Persona['kind']> | undefined): PersonaLookup {
  if (kinds === undefined) {
    return (id) => ({ id, kind: id === HUMAN_PERSONA_ID ? 'human' : id === 'pia' ? 'mission' : 'agent' });
  }
  return (id) => {
    const kind = kinds.get(id);
    return kind === undefined ? (id === HUMAN_PERSONA_ID ? { id, kind: 'human' } : null) : { id, kind };
  };
}

/** The persona id whose column the ticket stands in; null in a lifecycle column. */
export function holderPersonaOf(holder: TicketHolder): string | null {
  return holder.kind === 'none' ? null : holder.persona;
}
