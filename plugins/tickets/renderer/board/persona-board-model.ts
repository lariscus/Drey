// i18n: catalog
/**
 * The persona board's pure model (req-271, board 7e v2): Inbox · Prioritized
 * · the crew's personas in the crew's order (You included) · Done this week.
 * A card carries the chain as initials with its position marked, `Ben · 3 of 6`,
 * the badge and the status line; a column head carries its persona's load
 * (`2/2 · 1 waiting`). Agent and Mission Control columns that hold nothing fold
 * into one `+ n personas` chip. Everything here reads the snapshot's `lanes`
 * and `hold` (req-270's DTO) plus the fleet's runs and chain status; no DOM,
 * no words — the view words it from the catalog.
 */
import {
  cardsByLane,
  chainCellsOf,
  holdBadgeOf,
  holdDotOf,
  holdStatusOf,
  laneLoadOf,
  YOU_LANE,
  type BoardLane,
  type ChainCellState,
  type HoldBadge,
  type HoldStatus,
  type LaneLoad,
  type TicketHold,
} from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { ChainStatus, RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { DEFAULT_PRIORITY_CONFIG, priorityWeight, type BoardSnapshot, type TicketCard } from '../../shared/tickets';
import { liveRunOf } from '../work-groups';
import type { ProjectChip } from '../projects/project-scope';

/** One position of a card's chain: the persona's initials and how far the chain is. */
export interface ChainCellModel {
  readonly persona: string;
  /** `PA`; `··` for an entry that names no readable persona. */
  readonly initials: string;
  readonly name: string;
  readonly state: ChainCellState;
  /** The position names no persona of the crew. */
  readonly missing: boolean;
}

/** How the card is set apart: needs the owner (peach), a send-back (red), or the plain accent. */
export type CardTone = 'need' | 'sent-back' | 'plain';

export interface PersonaCardModel {
  readonly card: TicketCard;
  readonly id: string;
  readonly title: string;
  readonly hold: TicketHold | null;
  readonly cells: readonly ChainCellModel[];
  readonly badge: HoldBadge | null;
  /** The priority word beside the id when it is above normal and no badge stands there; null = none. */
  readonly priority: string | null;
  /** The holder's name and the position (`Ben`, 3, 6); null in a lifecycle column. */
  readonly position: { readonly name: string; readonly at: number; readonly of: number } | null;
  readonly status: HoldStatus | null;
  readonly dot: 'run' | 'wait' | 'need' | null;
  readonly tone: CardTone;
  /** The card's border is emphasized (sent back, shaping with the owner). */
  readonly emphasized: boolean;
  readonly cost: number | null;
  /** Accept and Send back… on the card: You's own entry. */
  readonly decide: boolean;
  /** The personas that worked a done ticket (`Ralf · Ben · Tessa`). */
  readonly workedBy: readonly string[];
  /** req-285: the project chip under *All projects*; null = none. */
  readonly project: ProjectChip | null;
}

export interface PersonaLaneModel {
  readonly lane: BoardLane;
  readonly initials: string;
  readonly cards: readonly PersonaCardModel[];
  readonly load: LaneLoad | null;
}

export interface PersonaBoardModel {
  readonly inbox: readonly PersonaCardModel[];
  readonly prioritized: readonly PersonaCardModel[];
  /** The shown persona columns in the crew's order. */
  readonly lanes: readonly PersonaLaneModel[];
  /** The empty agent / Mission Control lanes behind the `+ n personas` chip (shown in `lanes` too while unfolded). */
  readonly folded: readonly BoardLane[];
  readonly done: readonly PersonaCardModel[];
  readonly archive: readonly { readonly id: string; readonly title: string }[];
  readonly doneCost: number | null;
}

/** `Paul` -> `PA`, `Mary Ann` -> `MA`. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  }
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

function costOf(card: TicketCard): number | null {
  const cost = card.usage?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

/** What the fleet knows that the snapshot does not: runs, the pool's queue, the persona waits, the paused personas. */
export interface BoardLive {
  readonly runs: readonly RunInfo[];
  readonly chain: ChainStatus | null;
  /** The pool's words for a queued ticket (`queued · waits for a B slot`); null = not queued. */
  readonly queueWords: (ticketId: string) => string | null;
  readonly now: number;
  /**
   * req-285, the title bar's project filter: which tickets the board shows
   * (absent = all) and the chip a card carries (absent = none). Columns,
   * their load and their folding count every project.
   */
  readonly shows?: (card: TicketCard) => boolean;
  readonly chip?: (card: TicketCard) => ProjectChip | null;
}

interface Crew {
  readonly byId: ReadonlyMap<string, BoardLane>;
  readonly nameOf: (id: string) => string;
  readonly kindOf: (id: string) => BoardLane['kind'] | null;
}

function crewOf(lanes: readonly BoardLane[]): Crew {
  const byId = new Map(lanes.map((lane) => [lane.persona, lane]));
  return { byId, nameOf: (id) => byId.get(id)?.title ?? id, kindOf: (id) => byId.get(id)?.kind ?? null };
}

function toneOf(badge: HoldBadge | null, dot: PersonaCardModel['dot'], hold: TicketHold | null): CardTone {
  if (badge === 'sent-back-once' || badge === 'sent-back-twice') {
    return 'sent-back';
  }
  return dot === 'need' || hold?.holder === YOU_LANE ? 'need' : 'plain';
}

function priorityWordOf(card: TicketCard, snap: BoardSnapshot): string | null {
  const priorities = snap.priorities ?? DEFAULT_PRIORITY_CONFIG;
  const normal = priorities.order.includes('normal') ? priorityWeight('normal', priorities) : priorities.order.length;
  return priorityWeight(card.meta.priority, priorities) < normal ? card.meta.priority : null;
}

function statusOf(card: TicketCard, hold: TicketHold, live: BoardLive, crew: Crew): HoldStatus {
  const run = liveRunOf(card.id, live.runs);
  const started = run === null ? Number.NaN : Date.parse(run.startedAt);
  return holdStatusOf(
    hold,
    {
      running: run !== null,
      minutes: Number.isNaN(started) ? null : Math.max(0, Math.floor((live.now - started) / 60_000)),
      activity: run?.activity ?? null,
      queued: live.queueWords(card.id),
      waitsFor: live.chain?.personaWaits?.[card.id] ?? null,
      held: (live.chain?.pausedPersonas ?? []).includes(hold.holder),
    },
    crew.kindOf,
  );
}

function cellsOf(hold: TicketHold | null, card: TicketCard, crew: Crew): readonly ChainCellModel[] {
  const chain = hold?.chain ?? (card.meta.chain ?? []).map((entry) => entry.persona);
  const cells = hold !== null ? chainCellsOf(hold) : chain.map((persona, index) => ({ position: index + 1, persona, state: 'next' as const }));
  return cells.map((cell) => {
    const missing = crew.kindOf(cell.persona) === null && cell.persona !== YOU_LANE;
    const name = crew.nameOf(cell.persona);
    return { persona: cell.persona, initials: missing ? '··' : initialsOf(name), name, state: cell.state, missing };
  });
}

/** One card of the board, in a lifecycle column (no hold) or a persona's. */
export function personaCardOf(card: TicketCard, snap: BoardSnapshot, live: BoardLive, lanes: readonly BoardLane[]): PersonaCardModel {
  const crew = crewOf(lanes);
  const hold = card.hold ?? null;
  const status = hold === null ? null : statusOf(card, hold, live, crew);
  const dot = status === null ? null : holdDotOf(status);
  const badge = hold === null ? null : holdBadgeOf(hold);
  const tone = hold === null ? 'plain' : toneOf(badge, dot, hold);
  const cells = cellsOf(hold, card, crew);
  return {
    card,
    id: card.id,
    title: card.meta.title ?? card.id,
    hold,
    cells,
    badge,
    priority: badge === null ? priorityWordOf(card, snap) : null,
    // A question or the second send-back still names the persona it came from; no persona has no name to show.
    position: hold === null || hold.why === 'no-persona' ? null : { name: crew.nameOf(hold.why === 'entry' ? hold.holder : (hold.named ?? hold.holder)), at: hold.position, of: hold.length },
    status,
    dot,
    tone,
    emphasized: hold !== null && hold.holder !== YOU_LANE && (badge === 'sent-back-once' || status?.kind === 'shaping'),
    cost: costOf(card),
    decide: hold !== null && hold.holder === YOU_LANE && hold.why === 'entry',
    workedBy: [...new Set(cells.filter((cell) => crew.kindOf(cell.persona) === 'agent').map((cell) => cell.name))],
    project: live.chip?.(card) ?? null,
  };
}

const LIFECYCLE_EDGES = ['inbox', 'prioritized'] as const;

/** Running and waiting runs per persona for the column heads. */
function loadOf(lane: BoardLane, cards: readonly PersonaCardModel[], runs: readonly RunInfo[]): LaneLoad | null {
  const running = runs.filter((run) => run.persona === lane.persona && ['starting', 'running', 'stopping', 'detached'].includes(run.state)).length;
  const waiting = cards.filter((card) => card.status !== null && ['waits-for', 'queued', 'waiting', 'held'].includes(card.status.kind)).length;
  return laneLoadOf(lane, running, waiting);
}

/** The whole board; `unfolded` opens the folded personas' columns (the chip's click, a drag over it). */
export function personaBoardModelOf(snap: BoardSnapshot, live: BoardLive, unfolded: boolean): PersonaBoardModel {
  const lanes = snap.lanes ?? [];
  const configured = snap.columns.filter((column) => !column.unknown);
  const terminal = configured.length > 0 ? configured[configured.length - 1]!.phase.id : null;
  const shows = live.shows ?? (() => true);
  const cardsOfColumn = (id: string | null): readonly PersonaCardModel[] =>
    id === null ? [] : (snap.columns.find((column) => column.phase.id === id)?.tickets ?? []).filter((card) => card.hold === undefined && shows(card)).map((card) => personaCardOf(card, snap, live, lanes));
  const byLane = cardsByLane(snap);
  // The load and the folding count every project's cards (req-285): the pool is cross-project.
  const every = lanes.map((lane) => ({ lane, cards: (byLane.get(lane.persona) ?? []).map((card) => personaCardOf(card, snap, live, lanes)) }));
  const laneModels = every.map(({ lane, cards }) => ({ lane, initials: initialsOf(lane.title), cards: cards.filter((model) => shows(model.card)), load: loadOf(lane, cards, live.runs) }));
  const folded = every.filter((model) => model.lane.kind !== 'human' && model.cards.length === 0).map((model) => model.lane);
  const done = cardsOfColumn(terminal === 'inbox' || terminal === 'prioritized' ? null : terminal);
  return {
    inbox: cardsOfColumn(LIFECYCLE_EDGES[0]),
    prioritized: cardsOfColumn(LIFECYCLE_EDGES[1]),
    lanes: unfolded ? laneModels : laneModels.filter((model) => !folded.includes(model.lane)),
    folded,
    done,
    archive: snap.recentDone.map((entry) => ({ id: entry.id, title: entry.title ?? entry.id })),
    doneCost: sumKnown(done.map((card) => card.cost)),
  };
}

/** The crew's order with `dragged` moved before (or after) `target` — a column head's drop. */
export function laneOrderAfterDrop(order: readonly string[], dragged: string, target: string, after: boolean): readonly string[] {
  if (dragged === target || !order.includes(dragged) || !order.includes(target)) {
    return order;
  }
  const rest = order.filter((id) => id !== dragged);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

/** Where a card dropped on a column goes: a persona board move, a done transition, or nothing. */
export type BoardDrop =
  | { readonly kind: 'move'; readonly payload: { readonly kind: 'start' | 'hand'; readonly id: string; readonly persona: string } | { readonly kind: 'park'; readonly id: string; readonly stage: 'prioritized' | 'inbox' } }
  | { readonly kind: 'transition'; readonly id: string; readonly from: string; readonly to: string }
  | { readonly kind: 'none' };

/** The drop of `card` on column `target` (`inbox`, `prioritized`, `done` or a persona id). */
export function dropOf(card: TicketCard, target: string, terminal: string | null): BoardDrop {
  const held = card.hold !== undefined;
  if (target === 'done') {
    return terminal === null || card.phase === terminal ? { kind: 'none' } : { kind: 'transition', id: card.id, from: card.phase, to: terminal };
  }
  if (target === 'inbox' || target === 'prioritized') {
    if (held) {
      return { kind: 'move', payload: { kind: 'park', id: card.id, stage: target } };
    }
    return card.phase === target ? { kind: 'none' } : { kind: 'transition', id: card.id, from: card.phase, to: target };
  }
  return { kind: 'move', payload: { kind: held ? 'hand' : 'start', id: card.id, persona: target } };
}
