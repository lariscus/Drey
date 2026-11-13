/**
 * The persona board's DTO (req-270, the persona board concept §3, §4 and
 * §11; boards 7e v2 and 7a v2). On a lifecycle store the board's middle
 * columns are the personas that HOLD a ticket — derived from its chain and
 * cursor, never stored — and the step is status on the card. Every surface
 * (the desktop Board and Tickets panel, req-271; Mission Control, req-273)
 * reads the same two fields of the snapshot:
 *
 * - `BoardSnapshot.lanes` — the holder columns in the crew's order
 *   (`order:` in `tickets/_meta/crew.md`), You included; present exactly
 *   when the board is a persona board (a lifecycle store). Absent = the
 *   phase board (the files backend, a store not yet migrated).
 * - `TicketCard.hold` — on an `active` / `running` ticket of a persona
 *   board: who holds it, its position n of m, the chain as persona ids, why
 *   it stands there and its one send-back.
 *
 * The lifecycle columns (Inbox, Prioritized, Done) stay `BoardSnapshot.columns`
 * entries; an active ticket also stays in `columns` (in its holder's
 * pipeline column, or in one `active` column once the pipeline holds only
 * the lifecycle phases), so readers that walk the columns still see every
 * ticket. What the board does with a card is one of the {@link PersonaBoardMove}s.
 *
 * What a run adds at runtime (running, queued for a slot, waiting for its
 * persona, merging main) is not snapshot data: {@link holdStatusOf} folds
 * it in from the fleet's runs and chain status. Wording is each surface's
 * (the i18n catalog) — the helpers here return kinds, never sentences.
 */
import type { BoardMigrationOffer } from './board-migration';
import type { ChainSendBack } from './chain';
import type { BoardSnapshot, TicketCard } from './tickets';

/** The human persona's id — You's column. */
export const YOU_LANE = 'you';

/** One holder column: a persona of the crew, in the crew's order. */
export interface BoardLane {
  readonly persona: string;
  /** The persona's display name (`title:`); the id when the record has none. */
  readonly title: string;
  /** `agent` runs, `human` is You (never a slot), `mission` is Mission Control's persona (a turn, no slot). */
  readonly kind: 'agent' | 'human' | 'mission';
  /** `#rrggbb`, the column head's avatar; '' = none. */
  readonly color: string;
  /** The persona's own pool, `parallel:` — its maximum of parallel runs; null = no cap. */
  readonly parallel: number | null;
  /** `min:` — runs it may start beyond the big pool while it has fewer than this (default 0). */
  readonly min: number;
}

/**
 * Why the holder holds the ticket (the holder rule, concept §3):
 * - `entry` — the persona of the entry at the cursor (You's own entry included);
 * - `question` — a run asked (`awaiting: you`); `named` is the persona that asked;
 * - `second-send-back` — the second send-back went to You with both reasons;
 * - `no-persona` — the entry at the cursor names no readable persona.
 */
export type HoldWhy = 'entry' | 'question' | 'second-send-back' | 'no-persona';

/** Who holds an `active` / `running` ticket of a persona board, and where it is in its chain. */
export interface TicketHold {
  /** The persona id whose column the card stands in (`you` for You). */
  readonly holder: string;
  readonly why: HoldWhy;
  /** The cursor (1-based) and the chain's length — `Ben · 3 of 6`. */
  readonly position: number;
  readonly length: number;
  /** The chain as written: one persona id per position. */
  readonly chain: readonly string[];
  /** The mode of the entry at the cursor: `shape` = the owner's Shape chat with the persona. */
  readonly mode: 'shape' | null;
  /** The persona the entry at the cursor names (a You card's "Ben asks"); null without a chain. */
  readonly named: string | null;
  /** A run holds the claim (stage `running`). */
  readonly claimed: boolean;
  /** The ticket's one send-back once used (`x-sent-back`); null = none. */
  readonly sentBack: ChainSendBack | null;
  /** Open questions the owner has not answered (`why: question`); 0 otherwise. */
  readonly questions: number;
}

/** The card's persona board field (`TicketCard` extends it). */
export interface TicketHoldField {
  /** req-270: an active ticket's holder, position n of m, chain and why it stands there; absent on the phase board and in the lifecycle columns. */
  readonly hold?: TicketHold;
}

/** The snapshot's persona board fields (`BoardSnapshot` extends them). */
export interface PersonaBoardFields {
  /** req-270: the holder columns in the crew's order, You included — present exactly on a persona board (a lifecycle store). */
  readonly lanes?: readonly BoardLane[];
  /** req-268: the next step of the live board migration the owner may confirm (steps 3–5); absent = none. */
  readonly boardMigration?: BoardMigrationOffer;
}

/** True when the snapshot is a persona board (it carries holder lanes). */
export function isPersonaBoard(snap: { readonly lanes?: readonly BoardLane[] }): boolean {
  return snap.lanes !== undefined;
}

/**
 * The active cards by holder, each lane in board order (the columns, then the
 * derived order within one); a holder that is no lane of the snapshot keeps
 * its cards under its id.
 */
export function cardsByLane(snap: Pick<BoardSnapshot, 'columns'>): ReadonlyMap<string, readonly TicketCard[]> {
  const out = new Map<string, TicketCard[]>();
  for (const column of snap.columns) {
    for (const card of column.tickets) {
      if (card.hold !== undefined) {
        const list = out.get(card.hold.holder) ?? [];
        list.push(card);
        out.set(card.hold.holder, list);
      }
    }
  }
  return out;
}

/** The state of one position of the chain as a card draws it. */
export type ChainCellState = 'done' | 'now' | 'again' | 'next';

export interface ChainCell {
  readonly position: number;
  readonly persona: string;
  readonly state: ChainCellState;
}

/**
 * The chain's cells: positions before the cursor are done, the cursor is
 * now, and after a send-back the positions up to where it came from run
 * again (concept §4: a send-back invalidates every later entry).
 */
export function chainCellsOf(hold: Pick<TicketHold, 'chain' | 'position' | 'sentBack'>): readonly ChainCell[] {
  const againTo = hold.sentBack !== null && hold.position <= hold.sentBack.from ? hold.sentBack.from : 0;
  return hold.chain.map((persona, index) => {
    const position = index + 1;
    const state: ChainCellState = position < hold.position ? 'done' : position === hold.position ? 'now' : position <= againTo ? 'again' : 'next';
    return { position, persona, state };
  });
}

/** The card's badge: one word beside the id (board 7e v2); null = none. */
export type HoldBadge = 'sent-back-once' | 'sent-back-twice' | 'question' | 'no-persona' | 'accept';

export function holdBadgeOf(hold: TicketHold): HoldBadge | null {
  switch (hold.why) {
    case 'second-send-back':
      return 'sent-back-twice';
    case 'question':
      return 'question';
    case 'no-persona':
      return 'no-persona';
    default:
      break;
  }
  if (hold.holder === YOU_LANE) {
    return 'accept';
  }
  // The badge stays while the invalidated stretch runs again, then it is history.
  return hold.sentBack !== null && hold.position <= hold.sentBack.from ? 'sent-back-once' : null;
}

/** What the fleet says about a ticket right now — the runtime half of the card's status. */
export interface HoldLive {
  /** A live run of the ticket. */
  readonly running: boolean;
  /** Minutes since the live run started; null = unknown. */
  readonly minutes: number | null;
  /** The live run's activity line (`merging main` during the builder's sync-main). */
  readonly activity: string | null;
  /** The pool's line when the ticket waits for a slot (`waits for a B slot`); null = it does not. */
  readonly queued: string | null;
  /** The persona the ticket waits for (its persona runs its maximum); null = none. */
  readonly waitsFor: string | null;
  /** The holder is paused (by the owner or the breaker). */
  readonly held: boolean;
}

/** The card's status line as a kind — each surface words it from its catalog. */
export type HoldStatus =
  | { readonly kind: 'running'; readonly minutes: number | null; readonly from: string | null }
  | { readonly kind: 'merging-main' }
  | { readonly kind: 'committing' }
  | { readonly kind: 'queued'; readonly line: string }
  | { readonly kind: 'waits-for'; readonly persona: string }
  | { readonly kind: 'held' }
  | { readonly kind: 'shaping' }
  | { readonly kind: 'mission-turn' }
  | { readonly kind: 'asks'; readonly persona: string | null; readonly questions: number }
  | { readonly kind: 'decide' }
  | { readonly kind: 'no-persona'; readonly position: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'your-step' }
  | { readonly kind: 'waiting' };

/** The dot the status line carries: running (green), waiting (hollow), needs you (amber, glowing). */
export function holdDotOf(status: HoldStatus): 'run' | 'wait' | 'need' {
  switch (status.kind) {
    case 'running':
    case 'merging-main':
    case 'committing':
      return 'run';
    case 'shaping':
    case 'asks':
    case 'decide':
    case 'no-persona':
    case 'ready':
    case 'your-step':
      return 'need';
    default:
      return 'wait';
  }
}

/** The leaving action's activity while the builder merges `main` (fleet/orchestrate/run-leaving.ts). */
const MERGING_MAIN = 'merging main';

/** What stands at You for want of an answer: a question, the second send-back, no persona; null = an entry. */
function ownerStatusOf(hold: TicketHold): HoldStatus | null {
  switch (hold.why) {
    case 'question':
      return { kind: 'asks', persona: hold.named, questions: hold.questions };
    case 'second-send-back':
      return { kind: 'decide' };
    case 'no-persona':
      return { kind: 'no-persona', position: hold.position };
    default:
      return null;
  }
}

/** A live run's status: You's commit, the builder's sync-main, or the run (from the persona that sent it back). */
function runStatusOf(hold: TicketHold, live: HoldLive, human: boolean): HoldStatus {
  if (human) {
    return { kind: 'committing' };
  }
  if ((live.activity ?? '').startsWith(MERGING_MAIN)) {
    return { kind: 'merging-main' };
  }
  const from = hold.sentBack !== null && hold.position === hold.sentBack.to ? (hold.chain[hold.sentBack.from - 1] ?? null) : null;
  return { kind: 'running', minutes: live.minutes, from };
}

/** An agent entry without a run: the Shape chat, a held persona, its own pool, the big pool. */
function idleAgentStatusOf(hold: TicketHold, live: HoldLive): HoldStatus {
  if (hold.mode === 'shape') {
    return { kind: 'shaping' };
  }
  if (live.held) {
    return { kind: 'held' };
  }
  if (live.waitsFor !== null) {
    return { kind: 'waits-for', persona: live.waitsFor };
  }
  return live.queued !== null ? { kind: 'queued', line: live.queued } : { kind: 'waiting' };
}

/**
 * The card's status from its hold, the kinds of the crew and what the fleet
 * says. `kindOf` answers a persona id's kind (null = not in the crew).
 */
export function holdStatusOf(hold: TicketHold, live: HoldLive, kindOf: (persona: string) => BoardLane['kind'] | null): HoldStatus {
  const owner = ownerStatusOf(hold);
  if (owner !== null) {
    return owner;
  }
  const human = hold.holder === YOU_LANE || kindOf(hold.holder) === 'human';
  if (live.running) {
    return runStatusOf(hold, live, human);
  }
  if (human) {
    return hold.position >= hold.length ? { kind: 'ready' } : { kind: 'your-step' };
  }
  return kindOf(hold.holder) === 'mission' && hold.mode !== 'shape' ? { kind: 'mission-turn' } : idleAgentStatusOf(hold, live);
}

/** A column head's load (`Ben · 2/2 · 1 waiting`): runs now, the cap, what waits; You shows none. */
export interface LaneLoad {
  readonly running: number;
  readonly cap: number | null;
  readonly waiting: number;
  /** The persona runs its maximum — the count is emphasized. */
  readonly atCap: boolean;
}

export function laneLoadOf(lane: BoardLane, running: number, waiting: number): LaneLoad | null {
  if (lane.kind !== 'agent') {
    return null;
  }
  return { running, cap: lane.parallel, waiting, atCap: lane.parallel !== null && running >= lane.parallel };
}

/**
 * What the owner does to a card on the persona board (concept §4). Accept and
 * Send back with a target keep their own calls (`acceptTicket`, `sendBack`
 * with `position`); the column header's drag writes the crew's order
 * (`crewOrderSet`); a drop on Done is the ordinary `transition`.
 *
 * - `start` — Inbox / Prioritized onto a persona's column: stage `active`, the
 *   dropped-on persona takes the entry at the cursor;
 * - `hand` — from one holder to another (You included): the entry at the
 *   cursor becomes that persona; refused while a run holds the claim or the
 *   ticket waits for the owner's answer;
 * - `park` — any persona column back to Prioritized (or Inbox), the cursor kept.
 */
export type PersonaBoardMove =
  | { readonly kind: 'start'; readonly id: string; readonly persona: string }
  | { readonly kind: 'hand'; readonly id: string; readonly persona: string }
  | { readonly kind: 'park'; readonly id: string; readonly stage: 'prioritized' | 'inbox' };

const TICKET_ID = /^T-\d{4,}$/;
const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function textMatching(raw: unknown, pattern: RegExp): string | null {
  return typeof raw === 'string' && pattern.test(raw) ? raw : null;
}

/** The move a `personaBoardMove` payload carries; null when it is no valid move. */
export function parsePersonaBoardMove(payload: unknown): PersonaBoardMove | null {
  const raw = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const id = textMatching(raw['id'], TICKET_ID);
  const persona = textMatching(raw['persona'], PERSONA_ID);
  const kind = raw['kind'];
  if (id !== null && persona !== null && (kind === 'start' || kind === 'hand')) {
    return { kind, id, persona };
  }
  const stage = raw['stage'];
  return id !== null && kind === 'park' && (stage === 'prioritized' || stage === 'inbox') ? { kind: 'park', id, stage } : null;
}
