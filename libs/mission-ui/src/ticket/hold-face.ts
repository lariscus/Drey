// i18n: catalog
import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import type { I18n } from '../../../../shared/i18n/types';
import { tokenWords } from '../../../../shared/cost-table';
import type { McVerlaufEntry } from '../api/dto';
import { YOU_LANE, chainCellsOf, holdOf, lanesOf, type ChainCellState, type McHold, type McLane } from '../work/hold';
import type { McBoard } from '../work/work.model';

/**
 * The ticket screen on a persona board (req-273; boards 10e v2 `MPadWorkV2`,
 * 10o v2 `MPhoneReadyV2`): the pure halves — the flow row as names, the
 * send-back targets and their default, the cost by chain position. Words
 * come from the catalog; a phase-board ticket never reaches these.
 */

type Translate = (key: MessageKey, params?: MessageParams) => string;
type Mode = 'shape' | null;

/** A persona board ticket's hold with the board's lanes. */
export interface TicketHold {
  readonly hold: McHold;
  readonly lanes: readonly McLane[];
}

/** The open ticket's hold; null on the phase board (no lanes), for an unknown id or a card without a hold. */
export function ticketHoldOf(board: McBoard | null, id: string): TicketHold | null {
  const lanes = lanesOf(board);
  if (lanes === null || id === '') {
    return null;
  }
  for (const column of board?.columns ?? []) {
    const ticket = column.tickets.find((candidate) => candidate.id === id);
    if (ticket !== undefined) {
      const hold = holdOf(ticket);
      return hold === null ? null : { hold, lanes };
    }
  }
  return null;
}

/** The chain's mode per position off the ticket's own `chain:` (the hold names only the cursor's). */
export function chainModesOf(hold: Pick<McHold, 'chain' | 'position' | 'mode'>, entries: readonly { readonly persona: string; readonly mode: Mode }[]): readonly Mode[] {
  return hold.chain.map((persona, index) => {
    if (index + 1 === hold.position) {
      return hold.mode;
    }
    const entry = entries[index];
    return entry !== undefined && entry.persona === persona ? entry.mode : null;
  });
}

// --- the flow row ----------------------------------------------------------------

export interface HoldFlowCell {
  readonly label: string;
  readonly state: ChainCellState;
}

/** The flow row (`✓ Paul ✓ Ben You (6 of 6)`): the cells for the iPad, the joined runs for the phone. */
export interface HoldFlow {
  readonly done: readonly HoldFlowCell[];
  readonly now: string | null;
  readonly rest: readonly HoldFlowCell[];
  readonly note: string;
}

export function holdFlowOf(hold: McHold, titleOf: (persona: string) => string, t: Translate): HoldFlow {
  const cells = chainCellsOf(hold);
  const label = (persona: string, state: ChainCellState): string =>
    state === 'done' ? t('ticket.hold.flow_done', { name: titleOf(persona) }) : titleOf(persona);
  const now = cells.find((cell) => cell.state === 'now');
  return {
    done: cells.filter((cell) => cell.state === 'done').map((cell) => ({ label: label(cell.persona, cell.state), state: cell.state })),
    now: now === undefined ? null : titleOf(now.persona),
    rest: cells.filter((cell) => cell.state === 'again' || cell.state === 'next').map((cell) => ({ label: label(cell.persona, cell.state), state: cell.state })),
    note: t('ticket.hold.flow_position', { at: hold.position, of: hold.length }),
  };
}

// --- the send-back targets ------------------------------------------------------------

export interface HoldTarget {
  readonly position: number;
  readonly persona: string;
  /** `Ben · 3 of 6`. */
  readonly label: string;
  /** The grey word at the row's end: `shape`, else the persona's role. */
  readonly word: string;
}

const ROLE_KEYS: Readonly<Record<string, MessageKey>> = {
  planner: 'ticket.hold.role_planner',
  plan: 'ticket.hold.role_planner',
  builder: 'ticket.hold.role_builder',
  build: 'ticket.hold.role_builder',
  reviewer: 'ticket.hold.role_reviewer',
  review: 'ticket.hold.role_reviewer',
  tester: 'ticket.hold.role_tester',
  test: 'ticket.hold.role_tester',
};

/** A role as the row's word: the shipped roles as their step (`builder` → `build`), any other label as written. */
export function roleWordOf(role: string, t: Translate): string {
  const key = ROLE_KEYS[role.trim().toLowerCase()];
  return key === undefined ? role.trim() : t(key);
}

/** One row per earlier position, first to last. */
export function holdTargetsOf(
  hold: McHold,
  modes: readonly Mode[],
  titleOf: (persona: string) => string,
  roleOf: (persona: string) => string,
  t: Translate,
): readonly HoldTarget[] {
  return hold.chain.slice(0, Math.max(0, hold.position - 1)).map((persona, index) => ({
    position: index + 1,
    persona,
    label: t('board.position', { name: titleOf(persona), at: index + 1, of: hold.length }),
    word: modes[index] === 'shape' ? t('ticket.hold.word_shape') : roleWordOf(roleOf(persona), t),
  }));
}

const isBuildRole = (role: string): boolean => ['builder', 'build'].includes(role.trim().toLowerCase());

/** The preset target: the last earlier position whose persona builds, else the one just before the cursor; null at position 1. */
export function defaultTargetOf(hold: Pick<McHold, 'chain' | 'position'>, roleOf: (persona: string) => string): number | null {
  if (hold.position <= 1) {
    return null;
  }
  for (let position = hold.position - 1; position >= 1; position -= 1) {
    if (isBuildRole(roleOf(hold.chain[position - 1] ?? ''))) {
      return position;
    }
  }
  return hold.position - 1;
}

// --- the cost by position -----------------------------------------------------------------

/** The runs settled at one chain position (or, `position` null, runs no position takes). */
export interface PositionCost {
  readonly position: number | null;
  readonly persona: string | null;
  readonly models: readonly string[];
  readonly tokens: number | null;
  readonly minutes: number | null;
  readonly cost: number | null;
  readonly bad: boolean;
}

const tokenCountOf = (words: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)([kM]?)$/.exec(words.trim());
  return match === null ? null : Math.round(Number(match[1]) * (match[2] === 'M' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1));
};
const minutesOf = (words: string): number | null => {
  const match = /^(\d+)m$/.exec(words.trim());
  return match === null ? null : Number(match[1]);
};
const plus = (a: number | null, b: number | null): number | null => (b === null ? a : (a ?? 0) + b);

/**
 * The position a run settled at. The Verlauf line names its persona, not its
 * position, so the runs are walked in order: the next position of that persona
 * up to the cursor, else the nearest earlier one (a send-back's rerun). A
 * `:shape` entry is a chat and writes no line — it takes a run only when its
 * persona has no other position.
 */
export function positionOfRun(persona: string | null, chain: readonly string[], modes: readonly Mode[], last: number, cursor: number): number | null {
  if (persona === null) {
    return null;
  }
  const all = chain.map((id, index) => (id === persona ? index + 1 : 0)).filter((position) => position > 0);
  const runs = all.filter((position) => modes[position - 1] !== 'shape');
  const candidates = runs.length > 0 ? runs : all;
  const ahead = candidates.find((position) => position > last && position <= cursor);
  if (ahead !== undefined) {
    return ahead;
  }
  const behind = candidates.filter((position) => position <= last);
  return behind.length > 0 ? behind[behind.length - 1]! : (candidates[0] ?? null);
}

function addRun(into: PositionCost | undefined, position: number | null, entry: McVerlaufEntry): PositionCost {
  const model = entry.model ?? '';
  const models = into?.models ?? [];
  return {
    position,
    persona: into?.persona ?? entry.persona,
    models: model === '' || models.includes(model) ? models : [...models, model],
    tokens: plus(into?.tokens ?? null, tokenCountOf(entry.tokens)),
    minutes: plus(into?.minutes ?? null, minutesOf(entry.dauer)),
    cost: plus(into?.cost ?? null, typeof entry.cost === 'number' && Number.isFinite(entry.cost) && entry.cost > 0 ? entry.cost : null),
    bad: (into?.bad ?? false) || entry.ausgang === 'failed' || entry.ausgang === 'stopped',
  };
}

/** The settled runs summed per chain position, first position first; runs no position takes come last, per persona. */
export function positionCostsOf(entries: readonly McVerlaufEntry[], hold: Pick<McHold, 'chain' | 'position'>, modes: readonly Mode[]): readonly PositionCost[] {
  const placed = new Map<number, PositionCost>();
  const loose = new Map<string, PositionCost>();
  let last = 0;
  for (const entry of entries) {
    const position = positionOfRun(entry.persona, hold.chain, modes, last, hold.position);
    if (position === null) {
      const key = entry.persona ?? '';
      loose.set(key, addRun(loose.get(key), null, entry));
      continue;
    }
    last = position;
    placed.set(position, addRun(placed.get(position), position, entry));
  }
  return [...[...placed.values()].sort((a, b) => a.position! - b.position!), ...loose.values()];
}

// --- the table's words ---------------------------------------------------------------------

export interface PositionCostRow {
  /** `1 of 6 · Paul`. */
  readonly label: string;
  readonly model: string;
  readonly tokens: string;
  readonly time: string;
  readonly cost: string;
  /** The phone's grey line: model · tokens · time. */
  readonly sub: string;
  readonly bad: boolean;
}

export interface PositionCostView {
  readonly rows: readonly PositionCostRow[];
  readonly total: { readonly tokens: string; readonly time: string; readonly cost: string; readonly sub: string };
}

export function positionCostViewOf(i18n: I18n, costs: readonly PositionCost[], length: number, titleOf: (persona: string) => string): PositionCostView {
  const time = (minutes: number | null): string => (minutes === null ? '' : i18n.t('cost.table.minutes_short', { n: minutes }));
  const money = (cost: number | null): string => (cost === null ? '—' : i18n.formatCurrency(cost));
  const rows = costs.map((row) => {
    const name = row.persona === null ? '' : titleOf(row.persona);
    const model = row.models.join(' · ');
    const tokens = row.tokens === null ? '' : tokenWords(row.tokens);
    return {
      label: row.position === null ? name || '—' : i18n.t('ticket.hold.cost_row', { at: row.position, of: length, name }),
      model,
      tokens,
      time: time(row.minutes),
      cost: money(row.cost),
      sub: [model, tokens, time(row.minutes)].filter((bit) => bit !== '').join(' · '),
      bad: row.bad,
    };
  });
  const tokens = costs.reduce<number | null>((sum, row) => plus(sum, row.tokens), null);
  const minutes = costs.reduce<number | null>((sum, row) => plus(sum, row.minutes), null);
  const total = {
    tokens: tokens === null ? '' : tokenWords(tokens),
    time: time(minutes),
    cost: money(costs.reduce<number | null>((sum, row) => plus(sum, row.cost), null)),
  };
  return { rows, total: { ...total, sub: [total.tokens, total.time].filter((bit) => bit !== '').join(' · ') } };
}

/** A persona's display name: You's lane title (or the catalog's `You`), else the lane's, else the id raised. */
export function holdTitleOf(lanes: readonly McLane[], persona: string, t: Translate): string {
  const title = lanes.find((candidate) => candidate.persona === persona)?.title ?? '';
  if (persona === YOU_LANE) {
    return title !== '' && title !== YOU_LANE ? title : t('flow.pad.you');
  }
  return title !== '' ? title : persona.charAt(0).toUpperCase() + persona.slice(1);
}
