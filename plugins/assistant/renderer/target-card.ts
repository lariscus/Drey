/**
 * A proposal card under a conversation message (SDK 1.41, extended in 1.55):
 * the body, the buttons and the quiet note every card has, plus the optional
 * title with its status dot, the 2 x 2 figure grid, the list of lines and
 * the meta line a richer card brings (board 10u's Mission Control cards).
 * A card with none of the 1.55 fields is drawn exactly as before. The
 * Assistant only draws it; what the card says is the target's.
 */
import type { ConversationCard, ConversationCardMetric, ConversationCardRow } from '../../../shared/plugin-api/renderer';
import { el } from './dom.js';

/** What a card's buttons need of the target controller. */
export interface CardActions {
  busy(): boolean;
  act(cardId: string, actionId: string): Promise<void>;
}

/** True when the card carries a 1.55 field: it then wears the larger board look. */
export function isRichCard(card: ConversationCard): boolean {
  return card.title !== undefined || card.metrics !== undefined || card.rows !== undefined || card.meta !== undefined;
}

function dotNode(tone: 'attention' | 'negative'): HTMLElement {
  const dot = el('span', 'target-card-dot');
  dot.dataset['tone'] = tone;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function metricNode(metric: ConversationCardMetric): HTMLElement {
  const box = el('div', 'target-card-metric');
  box.appendChild(el('span', 'target-card-metric-label', metric.label));
  const line = el('div', 'target-card-metric-line');
  line.appendChild(el('b', 'target-card-metric-value', metric.value));
  const sub = metric.sub !== undefined && metric.sub !== '' ? el('span', 'target-card-metric-sub', metric.sub) : null;
  if (sub !== null && metric.inline === true) {
    line.appendChild(sub);
  }
  box.appendChild(line);
  if (sub !== null && metric.inline !== true) {
    box.appendChild(sub);
  }
  return box;
}

function rowNode(row: ConversationCardRow): HTMLElement {
  const line = el('div', 'target-card-row');
  if (row.dot !== undefined) {
    line.appendChild(dotNode(row.dot));
  }
  line.appendChild(el('span', 'target-card-row-text', row.text));
  return line;
}

export function proposalNode(targets: CardActions, card: ConversationCard): HTMLElement {
  const rich = isRichCard(card);
  const box = el('div', 'target-card' + (rich ? ' target-card-rich' : ''));
  if (card.title !== undefined) {
    const head = el('div', 'target-card-title');
    if (card.dot !== undefined) {
      head.appendChild(dotNode(card.dot));
    }
    head.appendChild(el('b', undefined, card.title));
    box.appendChild(head);
  }
  if (card.text !== '' || !rich) {
    box.appendChild(el('p', 'target-card-text', card.text));
  }
  if ((card.metrics ?? []).length > 0) {
    const grid = el('div', 'target-card-metrics');
    grid.append(...(card.metrics ?? []).map(metricNode));
    box.appendChild(grid);
  }
  if ((card.rows ?? []).length > 0) {
    const list = el('div', 'target-card-rows');
    list.append(...(card.rows ?? []).map(rowNode));
    box.appendChild(list);
  }
  if (card.note !== undefined) {
    box.appendChild(el('p', 'target-card-note', card.note));
  }
  if ((card.actions ?? []).length > 0) {
    const row = el('div', 'target-card-actions');
    for (const action of card.actions ?? []) {
      const button = el('button', 'target-card-btn' + (action.tone === 'primary' ? ' primary' : ''), action.label) as HTMLButtonElement;
      button.type = 'button';
      button.disabled = targets.busy();
      button.addEventListener('click', () => void targets.act(card.id, action.id));
      row.appendChild(button);
    }
    box.appendChild(row);
  }
  if (card.meta !== undefined) {
    box.appendChild(el('p', 'target-card-meta', card.meta));
  }
  return box;
}
