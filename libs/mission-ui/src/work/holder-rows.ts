import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import {
  YOU_LANE,
  holdLiveOf,
  holdOf,
  holdStatusOf,
  laneLoadOf,
  runningByPersonaOf,
  type McChainWaits,
  type HoldStatus,
  type McHold,
  type McHoldRun,
  type McLane,
} from './hold';
import { holdPositionOf, holdWordOf } from './hold-words';
import type { PhoneWorkGroup, PhoneWorkRow } from './phone-rows';
import type { McDoneEntry, NeedVm, TicketVm, WorkGroup } from './work.model';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** What the persona board's list is made of (board 10c v2 / 10e v2). */
export interface HolderListInput {
  readonly lanes: readonly McLane[];
  /** Every group of `groupsOf` (needs first, then the board's columns). */
  readonly groups: readonly WorkGroup[];
  readonly done: readonly McDoneEntry[];
  readonly runs: readonly McHoldRun[];
  readonly waits: McChainWaits | null;
  readonly paused: readonly string[];
  readonly now: number;
}

/** The lifecycle columns, folded at the foot of the list in this order. */
const FOLDED = ['prioritized', 'inbox'];
const DONE = 'done';

/** Who stands at You first: a run's question, no persona, the second send-back, another need, then You's own entry. */
function needRank(hold: McHold | null): number {
  switch (hold?.why) {
    case 'question':
      return 0;
    case 'no-persona':
      return 1;
    case 'second-send-back':
      return 2;
    default:
      return hold?.holder === YOU_LANE ? 4 : 3;
  }
}

interface Context {
  readonly input: HolderListInput;
  readonly t: Translate;
  readonly kindOf: (persona: string) => McLane['kind'] | null;
}

function statusOf(vm: TicketVm, hold: McHold, ctx: Context): HoldStatus {
  const { input } = ctx;
  return holdStatusOf(hold, holdLiveOf(vm.id, input.runs, input.waits, input.now, input.paused.includes(hold.holder)), ctx.kindOf);
}

/** The statuses a column head counts as waiting (the desktop board's rule, persona-board-model.ts). */
const WAITING_KINDS: readonly HoldStatus['kind'][] = ['waits-for', 'queued', 'waiting', 'held'];

function holdRow(vm: TicketVm, hold: McHold, need: NeedVm | null, ctx: Context): PhoneWorkRow {
  const { input, t } = ctx;
  const status = statusOf(vm, hold, ctx);
  // A need the hold does not explain (a red gate, a failed run) is named instead of the status.
  const word = need !== null && hold.why === 'entry' && hold.holder !== YOU_LANE ? need.kindLabel.toLowerCase() : holdWordOf(hold, status, input.lanes, t);
  const words = [vm.id, holdPositionOf(hold, t), word];
  return {
    key: vm.id,
    title: vm.title,
    meta: words.join(' · '),
    padMeta: words.join(' · '),
    cost: vm.costLabel,
    ticket: vm,
    need,
    plan: false,
    ticketId: vm.id,
  };
}

function plainRow(vm: TicketVm, need: NeedVm | null): PhoneWorkRow {
  return { key: vm.id, title: vm.title, meta: vm.id, padMeta: vm.id, cost: vm.costLabel, ticket: vm, need, plan: false, ticketId: vm.id };
}

function needOnlyRow(need: NeedVm): PhoneWorkRow {
  const id = need.need.ticketId ?? null;
  const words = [id, need.kindLabel.toLowerCase()].filter((part): part is string => part !== null && part !== '');
  return { key: need.key, title: need.need.title, meta: words.join(' · '), padMeta: words.join(' · '), cost: null, ticket: null, need, plan: false, ticketId: id };
}

/** The Needs-you group: the needs (one row per ticket) and every ticket that stands at You. */
function needsGroup(tickets: readonly TicketVm[], needs: readonly NeedVm[], ctx: Context, t: Translate): PhoneWorkGroup | null {
  const needOf = new Map<string, NeedVm>();
  const loose: NeedVm[] = [];
  for (const need of needs) {
    const id = need.need.ticketId ?? '';
    if (id === '') {
      loose.push(need);
    } else if (!needOf.has(id)) {
      needOf.set(id, need);
    }
  }
  const entries: { readonly rank: number; readonly row: PhoneWorkRow }[] = [];
  for (const vm of tickets) {
    const hold = holdOf(vm.ticket);
    const need = needOf.get(vm.id) ?? null;
    if (need === null && hold?.holder !== YOU_LANE) {
      continue;
    }
    needOf.delete(vm.id);
    entries.push({ rank: needRank(hold), row: hold === null ? plainRow(vm, need) : holdRow(vm, hold, need, ctx) });
  }
  // A need whose ticket is not on the board keeps its own row.
  const rows = [...entries.sort((a, b) => a.rank - b.rank).map((entry) => entry.row), ...[...needOf.values(), ...loose].map(needOnlyRow)];
  return rows.length === 0 ? null : { key: 'needs', title: t('work.phone.needs_you'), hot: true, startsOpen: true, rows };
}

/** The group head's load as one line (`Ben · 2/2 · 1 waiting`); null for You and Mission Control. */
export function laneLoadLineOf(lane: McLane, running: number, waiting: number, t: Translate): string | null {
  const load = laneLoadOf(lane, running, waiting);
  if (load === null) {
    return null;
  }
  const count = load.cap === null ? t('board.load.running', { n: load.running }) : t('board.load.count', { running: load.running, cap: load.cap });
  return `${lane.title} · ${count}${load.waiting > 0 ? t('board.load.waiting', { n: load.waiting }) : ''}`;
}

function laneGroup(lane: McLane, rows: readonly PhoneWorkRow[], running: number, waiting: number, t: Translate): PhoneWorkGroup {
  const load = laneLoadLineOf(lane, running, waiting, t);
  return {
    key: `lane:${lane.persona}`,
    title: lane.title,
    hot: false,
    startsOpen: true,
    rows,
    persona: { id: lane.persona, title: lane.title, color: lane.color },
    ...(load === null ? {} : { load }),
  };
}

/**
 * The persona board's list (boards 10c v2 and 10e v2): Needs you, then one
 * group per holder in the crew's order (an empty one leaves), then the folded
 * Prioritized, Inbox and Done this week. The row meta is `id · n/m · word`.
 */
export function holderGroupsOf(input: HolderListInput, t: Translate): readonly PhoneWorkGroup[] {
  const ctx: Context = { input, t, kindOf: (persona) => input.lanes.find((lane) => lane.persona === persona)?.kind ?? null };
  const tickets = uniqueTickets(input.groups);
  const needs = input.groups.flatMap((group) => (group.kind === 'needs' ? group.needs : []));
  const out: PhoneWorkGroup[] = [];
  const asked = needsGroup(tickets, needs, ctx, t);
  if (asked !== null) {
    out.push(asked);
  }
  const listed = new Set(asked?.rows.map((row) => row.ticketId ?? '') ?? []);
  out.push(...holderGroups(tickets, listed, ctx));
  out.push(...lifecycleGroups(input, tickets, listed, t));
  return out;
}

function holderGroups(tickets: readonly TicketVm[], listed: ReadonlySet<string>, ctx: Context): PhoneWorkGroup[] {
  const { input, t } = ctx;
  const byHolder = new Map<string, PhoneWorkRow[]>();
  const waiting = new Map<string, number>();
  for (const vm of tickets) {
    const hold = holdOf(vm.ticket);
    if (hold === null || listed.has(vm.id)) {
      continue;
    }
    const rows = byHolder.get(hold.holder) ?? [];
    rows.push(holdRow(vm, hold, null, ctx));
    byHolder.set(hold.holder, rows);
    if (WAITING_KINDS.includes(statusOf(vm, hold, ctx).kind)) {
      waiting.set(hold.holder, (waiting.get(hold.holder) ?? 0) + 1);
    }
  }
  const running = runningByPersonaOf(input.runs);
  const lanes = [...input.lanes, ...[...byHolder.keys()].filter((id) => !input.lanes.some((lane) => lane.persona === id)).map(unknownLane)];
  return lanes.flatMap((lane) => {
    const rows = byHolder.get(lane.persona) ?? [];
    return rows.length === 0 ? [] : [laneGroup(lane, rows, running.get(lane.persona) ?? 0, waiting.get(lane.persona) ?? 0, t)];
  });
}

function unknownLane(persona: string): McLane {
  return { persona, title: persona, kind: 'agent', color: '', parallel: null, min: 0 };
}

function lifecycleGroups(input: HolderListInput, tickets: readonly TicketVm[], listed: ReadonlySet<string>, t: Translate): PhoneWorkGroup[] {
  const unheld = tickets.filter((vm) => holdOf(vm.ticket) === null && !listed.has(vm.id));
  const inPhase = (phase: string): TicketVm[] => unheld.filter((vm) => vm.phaseId === phase);
  const out: PhoneWorkGroup[] = [];
  const named = new Set([...FOLDED, DONE]);
  // A column that is neither a lifecycle column nor a holder's (an unknown directory) keeps a plain open group.
  for (const vm of unheld.filter((candidate) => !named.has(candidate.phaseId))) {
    const group = out.find((candidate) => candidate.key === `phase:${vm.phaseId}`);
    if (group === undefined) {
      out.push({ key: `phase:${vm.phaseId}`, title: vm.phaseTitle, hot: false, startsOpen: true, rows: [plainRow(vm, null)] });
    } else {
      (group.rows as PhoneWorkRow[]).push(plainRow(vm, null));
    }
  }
  for (const phase of FOLDED) {
    const rows = inPhase(phase).map((vm) => plainRow(vm, null));
    if (rows.length > 0) {
      out.push({ key: `phase:${phase}`, title: rows[0]!.ticket!.phaseTitle, hot: false, startsOpen: false, rows });
    }
  }
  const doneIds = new Set(input.done.map((entry) => entry.id));
  const doneRows: PhoneWorkRow[] = [
    ...input.done.map((entry) => ({ key: entry.id, title: entry.title === null || entry.title === '' ? entry.id : entry.title, meta: entry.id, padMeta: entry.id, cost: null, ticket: null, need: null, plan: false, ticketId: entry.id })),
    ...inPhase(DONE).filter((vm) => !doneIds.has(vm.id)).map((vm) => plainRow(vm, null)),
  ];
  if (doneRows.length > 0) {
    out.push({ key: 'done', title: t('work.phone.done_week'), hot: false, startsOpen: false, rows: doneRows });
  }
  return out;
}

/** Every ticket once, in board order (an active ticket also stands in a column; the first sighting wins). */
function uniqueTickets(groups: readonly WorkGroup[]): readonly TicketVm[] {
  const seen = new Set<string>();
  const out: TicketVm[] = [];
  for (const group of groups) {
    if (group.kind !== 'phase') {
      continue;
    }
    for (const vm of group.tickets) {
      if (!seen.has(vm.id)) {
        seen.add(vm.id);
        out.push(vm);
      }
    }
  }
  return out;
}
