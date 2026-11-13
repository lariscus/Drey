// i18n: catalog
/**
 * The Board tab on persona columns (req-271, boards 7e v2): the header row
 * (Board, the pool chip, New idea), then Inbox · Prioritized · the `+ n
 * personas` chip · the crew's personas · Done this week. A card is dragged
 * between columns (start, hand, park, done — `dropOf`), a persona's column
 * head is dragged to reorder the crew (`crewOrderSet`, the Crew tab's key).
 * The view keeps only what is per tab: the folded chip, the open popover,
 * the unfolded "<n> more" tails.
 */
import type { BoardLane, LaneLoad } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { I18n } from '../../../../shared/i18n/types';
import type { BoardSnapshot } from '../../shared/tickets';
import { h, type DeskDeps } from '../desk-deps';
import { queueWordsFor } from '../queue-line';
import { personaPictures } from '../team/persona-pictures';
import { usd } from '../team/team-model';
import { openCardMenu, openSendBackPicker } from './persona-board-actions';
import { dropCard, type PersonaBoardContext } from './persona-board-drop';
import { laneOrderAfterDrop, personaBoardModelOf, type PersonaCardModel, type PersonaLaneModel } from './persona-board-model';
import { CARD_DRAG_TYPE, personaCardNode, type CardActions } from './persona-card-view';
import { poolChipNode } from './pool-chip';

const LANE_DRAG_TYPE = 'application/x-drey-lane';

/** How many cards a column shows before its "<n> more" row; You shows all — nothing that waits on the owner hides. */
const SHOWN = 3;
const DONE_SHOWN = 2;

/** The Done column's id (its "<n> more" tail key). */
const DONE_COLUMN = 'done';

function loadNode(lane: BoardLane, load: LaneLoad, i18n: I18n, filtered: boolean): HTMLElement {
  const node = h('span', 'pb-load');
  // req-285: under a project filter the load still counts every project's runs (the pool is cross-project).
  node.title = filtered
    ? i18n.t('board.load.every_project')
    : load.cap === null ? i18n.t('board.load.title_open', { name: lane.title, running: load.running, waiting: load.waiting }) : i18n.t('board.load.title', { name: lane.title, running: load.running, cap: load.cap, waiting: load.waiting });
  const count = load.cap === null ? i18n.t('board.load.running', { n: load.running }) : i18n.t('board.load.count', { running: load.running, cap: load.cap });
  node.append(h('span', load.atCap ? 'pb-load-full' : 'pb-load-count', count));
  if (load.waiting > 0) {
    node.append(document.createTextNode(i18n.t('board.load.waiting', { n: load.waiting })));
  }
  return node;
}

function headNode(title: string, count: number, right: HTMLElement | null, avatar: HTMLElement | null): HTMLElement {
  const head = h('div', 'pb-col-head');
  if (avatar !== null) {
    head.append(avatar);
  }
  head.append(h('b', 'pb-col-title', title), h('span', 'pb-col-count', String(count)), h('span', 'pb-grow'));
  if (right !== null) {
    head.append(right);
  }
  return head;
}

function avatarNode(model: PersonaLaneModel): HTMLElement {
  const avatar = h('span', 'pb-avatar', model.initials);
  avatar.setAttribute('aria-hidden', 'true');
  if (model.lane.color !== '') {
    avatar.style.setProperty('--persona-color', model.lane.color);
  }
  personaPictures.paint(avatar, model.lane.persona);
  return avatar;
}

/** A column that takes a card: the drop is decided by `dropOf` and sent as one call. */
function acceptCards(ctx: PersonaBoardContext, node: HTMLElement, target: string): void {
  node.dataset['drop'] = target;
  node.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes(CARD_DRAG_TYPE) === true) {
      event.preventDefault();
      node.classList.add('pb-col-over');
    }
  });
  node.addEventListener('dragleave', (event) => {
    if (!node.contains(event.relatedTarget as Node | null)) {
      node.classList.remove('pb-col-over');
    }
  });
  node.addEventListener('drop', (event) => {
    node.classList.remove('pb-col-over');
    const id = event.dataTransfer?.getData(CARD_DRAG_TYPE) ?? '';
    if (id === '') {
      return;
    }
    event.preventDefault();
    void dropCard(ctx, id, target);
  });
}

function reorderLanes(ctx: PersonaBoardContext, node: HTMLElement, persona: string, snap: BoardSnapshot): void {
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(LANE_DRAG_TYPE, persona);
    node.classList.add('pb-dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('pb-dragging'));
  node.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes(LANE_DRAG_TYPE) === true) {
      event.preventDefault();
    }
  });
  node.addEventListener('drop', (event) => {
    const dragged = event.dataTransfer?.getData(LANE_DRAG_TYPE) ?? '';
    if (dragged === '') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = node.getBoundingClientRect();
    const order = (snap.lanes ?? []).map((lane) => lane.persona);
    const next = laneOrderAfterDrop(order, dragged, persona, event.clientX > rect.left + rect.width / 2);
    if (next.join() !== order.join()) {
      const { deps } = ctx;
      void deps.mutate(deps.api.i18n.t('tickets.team.reordering'), () => deps.invoke('crewOrderSet', { order: next }));
    }
  });
}

function cardsNode(ctx: PersonaBoardContext, key: string, cards: readonly PersonaCardModel[], limit: number | null, actions: CardActions, nameOf: (id: string) => string, done = false): HTMLElement {
  const i18n = ctx.deps.api.i18n;
  const body = h('div', 'pb-col-body');
  const open = limit === null || ctx.state.more.has(key);
  for (const card of open ? cards : cards.slice(0, limit)) {
    body.append(personaCardNode(card, actions, i18n, nameOf, done));
  }
  return body;
}

function moreNode(ctx: PersonaBoardContext, key: string, hidden: number): HTMLElement {
  const more = h('button', 'pb-more', ctx.deps.api.i18n.t('board.more', { n: hidden }));
  more.type = 'button';
  more.addEventListener('click', () => {
    ctx.state.more.add(key);
    ctx.repaint();
  });
  return more;
}

function columnNode(ctx: PersonaBoardContext, spec: { readonly column: string; readonly cls: string; readonly head: HTMLElement; readonly cards: readonly PersonaCardModel[]; readonly limit: number | null; readonly extra?: number }, actions: CardActions, nameOf: (id: string) => string, done = false): HTMLElement {
  const col = h('section', `pb-col ${spec.cls}`);
  col.dataset['column'] = spec.column;
  const body = cardsNode(ctx, spec.column, spec.cards, spec.limit, actions, nameOf, done);
  const total = spec.cards.length + (spec.extra ?? 0);
  const shown = spec.limit === null || ctx.state.more.has(spec.column) ? total : Math.min(spec.cards.length, spec.limit);
  if (total > shown) {
    body.append(moreNode(ctx, spec.column, total - shown));
  }
  col.append(spec.head, body);
  acceptCards(ctx, col, spec.column);
  return col;
}

function foldChipNode(ctx: PersonaBoardContext, folded: readonly BoardLane[]): HTMLElement {
  const i18n = ctx.deps.api.i18n;
  const col = h('div', 'pb-fold');
  const chip = h('button', 'pb-fold-chip', i18n.t('board.fold.chip', { n: folded.length }));
  chip.type = 'button';
  chip.title = i18n.t('board.fold.title', { names: folded.map((lane) => lane.title).join(', ') });
  chip.setAttribute('aria-expanded', 'false');
  const unfold = (): void => {
    ctx.state.unfolded = true;
    ctx.repaint();
  };
  chip.addEventListener('click', unfold);
  // A card dragged over the chip opens the folded columns for the drop.
  chip.addEventListener('dragenter', (event) => {
    if (event.dataTransfer?.types.includes(CARD_DRAG_TYPE) === true) {
      unfold();
    }
  });
  col.append(h('div', 'pb-fold-gap'), chip);
  return col;
}

function cardActions(ctx: PersonaBoardContext): CardActions {
  const { deps } = ctx;
  const i18n = deps.api.i18n;
  return {
    open: (card) => deps.openTicket(card.card),
    accept: (card) => void deps.mutate(i18n.t('board.busy.accept', { id: card.id }), () => deps.invoke('acceptTicket', { id: card.id })),
    sendBack: (card, anchor) => openSendBackPicker(deps, card, anchor),
    menu: (card, at) => openCardMenu(ctx, card, at),
  };
}

/** The header row and the columns of a persona board. */
export function personaBoardNodes(ctx: PersonaBoardContext, snap: BoardSnapshot): readonly HTMLElement[] {
  const { deps, state } = ctx;
  const i18n = deps.api.i18n;
  const chain = deps.chain();
  const scope = deps.scope?.() ?? null;
  const model = personaBoardModelOf(
    snap,
    { runs: deps.runs(), chain, queueWords: (id) => queueWordsFor(chain?.queue, id, i18n)?.short ?? null, now: Date.now(), ...(scope === null ? {} : { shows: (card) => scope.shows(card), chip: (card) => scope.chip(card) }) },
    state.unfolded,
  );
  const lanes = snap.lanes ?? [];
  const nameOf = (id: string): string => lanes.find((lane) => lane.persona === id)?.title ?? id;
  const actions = cardActions(ctx);

  const head = h('header', 'pb-head');
  const newIdea = h('button', 'pb-btn pb-btn-primary', i18n.t('board.new_idea'));
  newIdea.type = 'button';
  newIdea.addEventListener('click', () => deps.newIdea());
  const togglePool = (open: boolean): void => {
    state.poolOpen = open;
    ctx.repaint();
  };
  head.append(h('b', 'pb-h', i18n.t('board.title')), h('span', 'pb-grow'), poolChipNode(deps, lanes, state.poolOpen, togglePool), newIdea);

  const cols = h('div', 'pb-cols');
  cols.append(
    columnNode(ctx, { column: 'inbox', cls: 'pb-col-edge', head: headNode(i18n.t('board.column.inbox'), model.inbox.length, null, null), cards: model.inbox, limit: SHOWN }, actions, nameOf),
    columnNode(ctx, { column: 'prioritized', cls: 'pb-col-edge', head: headNode(i18n.t('board.column.prioritized'), model.prioritized.length, null, null), cards: model.prioritized, limit: SHOWN }, actions, nameOf),
  );
  if (model.folded.length > 0 && !state.unfolded) {
    cols.append(foldChipNode(ctx, model.folded));
  }
  for (const lane of model.lanes) {
    const right = lane.load === null ? null : loadNode(lane.lane, lane.load, i18n, scope?.filtered === true);
    const laneHead = headNode(lane.lane.title, lane.cards.length, right, avatarNode(lane));
    laneHead.dataset['persona'] = lane.lane.persona;
    reorderLanes(ctx, laneHead, lane.lane.persona, snap);
    cols.append(columnNode(ctx, { column: lane.lane.persona, cls: 'pb-col-lane', head: laneHead, cards: lane.cards, limit: lane.lane.kind === 'human' ? null : SHOWN }, actions, nameOf));
  }
  const doneHead = headNode(i18n.t('board.column.done'), model.done.length + model.archive.length, model.doneCost === null ? null : h('span', 'pb-col-cost', usd(model.doneCost)), null);
  const doneCol = columnNode(ctx, { column: DONE_COLUMN, cls: 'pb-col-done', head: doneHead, cards: model.done, limit: DONE_SHOWN, extra: model.archive.length }, actions, nameOf, true);
  const doneBody = doneCol.querySelector<HTMLElement>('.pb-col-body')!;
  const room = state.more.has(DONE_COLUMN) ? model.archive.length : Math.max(0, DONE_SHOWN - model.done.length);
  const more = doneBody.querySelector('.pb-more');
  for (const entry of model.archive.slice(0, room)) {
    const card = h('article', 'pb-card pb-card-archived');
    card.dataset['id'] = entry.id;
    card.append(h('div', 'pb-card-top'), h('div', 'pb-card-title', entry.title));
    card.firstElementChild!.append(h('span', 'pb-card-id', entry.id));
    doneBody.insertBefore(card, more);
  }
  cols.append(doneCol);
  return [head, cols];
}
