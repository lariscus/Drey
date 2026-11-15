// i18n: catalog
/**
 * The persona board's two floating surfaces (req-271): the Send back… picker
 * of a You card — the earlier positions of the chain, a mandatory note — and a
 * card's menu, the keyboard's way to every drop the mouse makes (start on /
 * hand to a persona, park, done).
 */
import { h, type DeskDeps } from './desk-deps';
import type { PersonaCardModel } from './persona-board-model';
import { dropCard, type PersonaBoardContext } from './persona-board-drop';

/** Removes every open board popover; one at a time. */
function closeFloating(): void {
  for (const node of document.querySelectorAll('.pb-floating')) {
    node.remove();
  }
}

/** Places a floating node under an anchor point and closes it on Escape or a click outside. */
function float(node: HTMLElement, at: { readonly x: number; readonly y: number }, onClose: () => void = () => undefined): () => void {
  closeFloating();
  node.classList.add('pb-floating');
  node.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - 320))}px`;
  node.style.top = `${at.y}px`;
  document.body.append(node);
  const outside = (event: Event): void => {
    if (!node.contains(event.target as Node)) {
      close();
    }
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    node.remove();
    window.removeEventListener('mousedown', outside, true);
    window.removeEventListener('keydown', escape, true);
    onClose();
  };
  window.addEventListener('mousedown', outside, true);
  window.addEventListener('keydown', escape, true);
  return close;
}

/** Send back… at You: pick an earlier position, say why, send. */
export function openSendBackPicker(deps: DeskDeps, card: PersonaCardModel, anchor: HTMLElement): void {
  const hold = card.hold;
  if (hold === null || hold.position <= 1) {
    return;
  }
  const i18n = deps.api.i18n;
  const lanes = deps.snapshot()?.lanes ?? [];
  const nameOf = (id: string): string => lanes.find((lane) => lane.persona === id)?.title ?? id;
  const box = h('form', 'pb-sendback');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', i18n.t('board.sendback.title', { id: card.id }));
  box.append(h('b', 'pb-sendback-title', i18n.t('board.sendback.title', { id: card.id })));
  const list = h('div', 'pb-sendback-list');
  list.setAttribute('role', 'radiogroup');
  const isAgent = (id: string): boolean => lanes.find((lane) => lane.persona === id)?.kind === 'agent';
  const earlier = hold.chain.slice(0, hold.position - 1).map((persona, index) => ({ persona, position: index + 1 }));
  const preset = [...earlier].reverse().find((entry) => isAgent(entry.persona))?.position ?? earlier[earlier.length - 1]!.position;
  for (const entry of earlier) {
    const row = h('label', 'pb-sendback-row');
    const radio = h('input');
    radio.type = 'radio';
    radio.name = 'pb-sendback-position';
    radio.value = String(entry.position);
    radio.checked = entry.position === preset;
    row.append(radio, h('span', '', i18n.t('board.sendback.position', { position: entry.position, name: nameOf(entry.persona) })));
    list.append(row);
  }
  const note = h('textarea', 'pb-sendback-note');
  note.rows = 3;
  note.setAttribute('aria-label', i18n.t('board.sendback.note'));
  const send = h('button', 'pb-decide-accept', i18n.t('board.send_back_confirm'));
  send.type = 'submit';
  send.disabled = true;
  note.addEventListener('input', () => {
    send.disabled = note.value.trim() === '';
  });
  const cancel = h('button', 'pb-decide-back', i18n.t('board.cancel'));
  cancel.type = 'button';
  const buttons = h('div', 'pb-decide');
  buttons.append(send, cancel);
  box.append(list, note, buttons);
  const rect = anchor.getBoundingClientRect();
  const close = float(box, { x: rect.left - 200, y: rect.bottom + 4 }, () => anchor.focus());
  cancel.addEventListener('click', close);
  box.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = note.value.trim();
    const picked = Number(box.querySelector<HTMLInputElement>('input[name="pb-sendback-position"]:checked')?.value ?? preset);
    if (text === '') {
      return;
    }
    close();
    void deps.mutate(i18n.t('board.busy.send_back', { id: card.id }), () => deps.invoke('sendBack', { id: card.id, note: text, position: picked }));
  });
  note.focus();
}

/** A card's menu: the drops the mouse makes, as rows. */
export function openCardMenu(ctx: PersonaBoardContext, card: PersonaCardModel, at: { readonly x: number; readonly y: number }): void {
  const { deps } = ctx;
  const i18n = deps.api.i18n;
  const lanes = deps.snapshot()?.lanes ?? [];
  const menu = h('div', 'tickets-menu pb-menu');
  menu.setAttribute('role', 'menu');
  let close = (): void => undefined;
  const item = (label: string, target: string): void => {
    const button = h('button', 'tickets-menu-item', label);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      close();
      void dropCard(ctx, card.id, target);
    });
    menu.append(button);
  };
  const held = card.hold;
  for (const lane of lanes) {
    if (held === null) {
      item(i18n.t('board.menu.start', { name: lane.title }), lane.persona);
    } else if (lane.persona !== held.holder) {
      item(i18n.t('board.menu.hand', { name: lane.title }), lane.persona);
    }
  }
  if (card.card.phase !== 'prioritized') {
    item(i18n.t('board.menu.prioritized'), 'prioritized');
  }
  if (card.card.phase !== 'inbox') {
    item(i18n.t('board.menu.inbox'), 'inbox');
  }
  item(i18n.t('board.menu.done'), 'done');
  close = float(menu, at, () => document.querySelector<HTMLElement>(`.pb-card[data-id="${CSS.escape(card.id)}"]`)?.focus());
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}
