// i18n: catalog
/**
 * One card of the persona board (board 7e v2): id and badge, title, the chain
 * as initials (done muted, the cursor filled, a send-back's stretch dashed),
 * `Ben · 3 of 6` with the cost, the status line with its dot, and at You's own
 * entry the Accept / Send back… pair. Plain DOM over `persona-board-model.ts`.
 */
import type { HoldBadge, HoldStatus } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { I18n } from '../../../../shared/i18n/types';
import { h } from '../desk-deps';
import { usd } from '../team/team-model';
import type { ChainCellModel, PersonaCardModel } from './persona-board-model';

/** The MIME type a dragged card carries (its ticket id). */
export const CARD_DRAG_TYPE = 'application/x-drey-ticket';

export interface CardActions {
  open(card: PersonaCardModel): void;
  accept(card: PersonaCardModel): void;
  sendBack(card: PersonaCardModel, anchor: HTMLElement): void;
  menu(card: PersonaCardModel, at: { readonly x: number; readonly y: number }): void;
}

function badgeText(badge: HoldBadge, i18n: I18n): string {
  switch (badge) {
    case 'sent-back-once':
      return i18n.t('board.badge.sent_back_once');
    case 'sent-back-twice':
      return i18n.t('board.badge.sent_back_twice');
    case 'question':
      return i18n.t('board.badge.question');
    case 'no-persona':
      return i18n.t('board.badge.no_persona');
    case 'accept':
      return i18n.t('board.badge.accept');
  }
}

/** The status line as the catalog words it. */
export function statusText(status: HoldStatus, i18n: I18n, nameOf: (id: string) => string): string {
  switch (status.kind) {
    case 'running':
      if (status.from !== null) {
        return i18n.t('board.status.running_from', { name: nameOf(status.from) });
      }
      return status.minutes === null ? i18n.t('board.status.running') : i18n.t('board.status.running_for', { duration: i18n.formatDuration(status.minutes * 60_000) });
    case 'merging-main':
      return i18n.t('board.status.merging_main');
    case 'committing':
      return i18n.t('board.status.committing');
    case 'queued':
      return status.line;
    case 'waits-for':
      return i18n.t('board.status.waits_for', { name: nameOf(status.persona) });
    case 'held':
      return i18n.t('board.status.held');
    case 'shaping':
      return i18n.t('board.status.shaping');
    case 'mission-turn':
      return i18n.t('board.status.mission_turn');
    case 'asks':
      return i18n.t('board.status.asks', { name: status.persona === null ? i18n.t('board.status.someone') : nameOf(status.persona), n: status.questions });
    case 'decide':
      return i18n.t('board.status.decide');
    case 'no-persona':
      return i18n.t('board.status.no_persona', { position: status.position });
    case 'ready':
      return i18n.t('board.status.ready');
    case 'your-step':
      return i18n.t('board.status.your_step');
    case 'waiting':
      return i18n.t('board.status.waiting');
  }
}

function cellTitle(cell: ChainCellModel, i18n: I18n): string {
  if (cell.missing) {
    return i18n.t('board.cell.missing');
  }
  switch (cell.state) {
    case 'done':
      return i18n.t('board.cell.done', { name: cell.name });
    case 'now':
      return i18n.t('board.cell.now', { name: cell.name });
    case 'again':
      return i18n.t('board.cell.again', { name: cell.name });
    default:
      return cell.name;
  }
}

function chainNode(card: PersonaCardModel, i18n: I18n): HTMLElement {
  const row = h('span', 'pb-chain');
  for (const cell of card.cells) {
    const node = h('span', `pb-cell pb-cell-${cell.state}${cell.state === 'now' ? ` pb-cell-${card.tone}` : ''}`, cell.initials);
    node.title = cellTitle(cell, i18n);
    row.append(node);
  }
  return row;
}

function topNode(card: PersonaCardModel, i18n: I18n): HTMLElement {
  const top = h('div', 'pb-card-top');
  top.append(h('span', 'pb-card-id', card.id));
  top.append(h('span', 'pb-grow'));
  if (card.badge !== null) {
    top.append(h('span', `pb-badge pb-badge-${card.badge}`, badgeText(card.badge, i18n)));
  } else if (card.priority !== null) {
    top.append(h('span', 'pb-badge pb-badge-priority', card.priority));
  }
  return top;
}

/** req-305: the Shape chat's end — one button, the same Accept the engine reads at a `:shape` entry. */
function shapingNode(card: PersonaCardModel, actions: CardActions, i18n: I18n): HTMLElement {
  const row = h('div', 'pb-decide');
  const done = h('button', 'pb-decide-accept pb-shaping-done', i18n.t('board.shaping_done'));
  done.type = 'button';
  done.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.accept(card);
  });
  row.append(done);
  return row;
}

function decideNode(card: PersonaCardModel, actions: CardActions, i18n: I18n): HTMLElement {
  const row = h('div', 'pb-decide');
  const accept = h('button', 'pb-decide-accept', i18n.t('board.accept'));
  accept.type = 'button';
  accept.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.accept(card);
  });
  const back = h('button', 'pb-decide-back', i18n.t('board.send_back'));
  back.type = 'button';
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.sendBack(card, back);
  });
  row.append(accept, back);
  return row;
}

/** One card; `done` draws the Done column's form (who worked it instead of the chain). */
export function personaCardNode(card: PersonaCardModel, actions: CardActions, i18n: I18n, nameOf: (id: string) => string, done = false): HTMLElement {
  const node = h('article', `pb-card${card.tone === 'need' && card.hold !== null ? ' pb-card-need' : ''}${card.emphasized ? ' pb-card-emph' : ''}`);
  node.dataset['id'] = card.id;
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${card.id} ${card.title}`);
  node.title = `${card.id} - ${card.title}`;
  node.draggable = !done;
  node.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(CARD_DRAG_TYPE, card.id);
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'move';
    }
    node.classList.add('pb-dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('pb-dragging'));
  node.addEventListener('click', () => actions.open(card));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === node) {
      event.preventDefault();
      actions.open(card);
    } else if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && !done) {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      actions.menu(card, { x: rect.left, y: rect.bottom + 2 });
    }
  });
  if (!done) {
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      actions.menu(card, { x: event.clientX, y: event.clientY });
    });
  }
  node.append(topNode(card, i18n), h('div', 'pb-card-title', card.title));
  if (!done && card.cells.length > 0) {
    node.append(chainNode(card, i18n));
  }
  const who = done ? card.workedBy.join(' · ') : card.position === null ? '' : i18n.t('board.position', { name: card.position.name, at: card.position.at, of: card.position.of });
  if (who !== '' || (card.hold !== null && card.cost !== null) || done) {
    const meta = h('div', 'pb-card-meta');
    meta.append(h('span', 'pb-card-who', who), h('span', 'pb-grow'));
    if (card.cost !== null) {
      meta.append(h('span', 'pb-card-cost', usd(card.cost)));
    }
    node.append(meta);
  }
  if (card.decide) {
    node.append(decideNode(card, actions, i18n));
  } else if (card.status !== null && card.dot !== null) {
    const line = h('div', 'pb-status');
    line.append(h('span', `pb-dot pb-dot-${card.dot}`), h('span', 'pb-status-text', statusText(card.status, i18n, nameOf)));
    node.append(line);
  }
  if (card.shaping) {
    node.append(shapingNode(card, actions, i18n));
  }
  return node;
}
