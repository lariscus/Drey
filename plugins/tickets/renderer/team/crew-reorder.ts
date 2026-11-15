// i18n: catalog
/**
 * Reordering the crew in the Crew tab (req-258, the persona board concept
 * §9): a persona card is dragged onto another, moved with
 * Ctrl+Shift+PageUp / PageDown while focused (the tab-move chord of
 * browsers and editors — Alt+Left/Right is the app's Go back / Go forward),
 * or moved from its menu (right-click, the context-menu key or Shift+F10):
 * Move left / Move right. Every way writes the whole list as `order:` in
 * `tickets/_meta/crew.md` (`crewOrderSet`, one commit).
 */
import { h } from '../board/desk-deps';
import type { Translate } from './persona-dom';

/** The order with `id` moved by `delta` places; the same order at an edge. */
export function movedOrder(ids: readonly string[], id: string, delta: -1 | 1): readonly string[] {
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= ids.length) {
    return ids;
  }
  const next = [...ids];
  next.splice(at, 1);
  next.splice(to, 0, id);
  return next;
}

/** The order with `dragged` dropped before (or after) `target`. */
export function droppedOrder(ids: readonly string[], dragged: string, target: string, after: boolean): readonly string[] {
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) {
    return ids;
  }
  const rest = ids.filter((id) => id !== dragged);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

/** The full crew with the reordered ones in their new order and every other id (the human, who has no card) in its place. */
export function withOthersKept(full: readonly string[], order: readonly string[]): readonly string[] {
  const moved = new Set(order);
  const queue = order.filter((id) => full.includes(id));
  let next = 0;
  return full.map((id) => (moved.has(id) ? queue[next++]! : id));
}

const sameOrder =(a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

export interface CrewReorder {
  readonly t: Translate;
  /** The crew's ids in the order the cards show. */
  ids(): readonly string[];
  /** Writes the new order; `focus` is the card that keeps the focus after the repaint. */
  apply(order: readonly string[], focus: string | null): void;
}

const DRAG_TYPE = 'application/x-drey-persona';

function closeMenus(): void {
  for (const menu of document.querySelectorAll('.crew-order-menu')) {
    menu.remove();
  }
}

function openMenu(reorder: CrewReorder, id: string, at: { readonly x: number; readonly y: number }): void {
  closeMenus();
  const menu = h('div', 'tickets-menu crew-order-menu');
  menu.setAttribute('role', 'menu');
  const ids = reorder.ids();
  const outside = (event: Event): void => {
    if (!menu.contains(event.target as Node)) {
      close();
    }
  };
  const close = (): void => {
    menu.remove();
    window.removeEventListener('mousedown', outside, true);
  };
  const item = (label: string, delta: -1 | 1): HTMLButtonElement => {
    const button = h('button', 'tickets-menu-item', label);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.disabled = sameOrder(movedOrder(ids, id, delta), ids);
    button.addEventListener('click', () => {
      close();
      reorder.apply(movedOrder(ids, id, delta), id);
    });
    return button;
  };
  menu.append(item(reorder.t('tickets.team.move_left'), -1), item(reorder.t('tickets.team.move_right'), 1));
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      document.querySelector<HTMLElement>(`[data-persona="${CSS.escape(id)}"]`)?.focus();
    }
  });
  menu.style.left = `${at.x}px`;
  menu.style.top = `${at.y}px`;
  document.body.append(menu);
  window.addEventListener('mousedown', outside, true);
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

function keyMove(event: KeyboardEvent): -1 | 1 | null {
  if (!event.ctrlKey || !event.shiftKey || event.altKey) {
    return null;
  }
  return event.key === 'PageUp' ? -1 : event.key === 'PageDown' ? 1 : null;
}

function attachKeys(node: HTMLElement, id: string, reorder: CrewReorder): void {
  node.addEventListener('keydown', (event) => {
    if (event.target !== node) {
      return;
    }
    const delta = keyMove(event);
    if (delta !== null) {
      event.preventDefault();
      const ids = reorder.ids();
      const next = movedOrder(ids, id, delta);
      if (!sameOrder(next, ids)) {
        reorder.apply(next, id);
      }
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      openMenu(reorder, id, { x: rect.left, y: rect.bottom + 2 });
    }
  });
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu(reorder, id, { x: event.clientX, y: event.clientY });
  });
}

function dropSide(node: HTMLElement, event: DragEvent): boolean {
  const rect = node.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2;
}

function attachDrag(node: HTMLElement, id: string, reorder: CrewReorder): void {
  node.draggable = true;
  const clear = (): void => node.classList.remove('crew-drop-before', 'crew-drop-after');
  node.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(DRAG_TYPE, id);
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'move';
    }
    node.classList.add('crew-dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('crew-dragging'));
  node.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    const after = dropSide(node, event);
    node.classList.toggle('crew-drop-after', after);
    node.classList.toggle('crew-drop-before', !after);
  });
  node.addEventListener('dragleave', clear);
  node.addEventListener('drop', (event) => {
    const dragged = event.dataTransfer?.getData(DRAG_TYPE) ?? '';
    clear();
    if (dragged === '') {
      return;
    }
    event.preventDefault();
    const ids = reorder.ids();
    const next = droppedOrder(ids, dragged, id, dropSide(node, event));
    if (!sameOrder(next, ids)) {
      reorder.apply(next, dragged);
    }
  });
}

/** Makes one persona card reorderable: drag, the keys, the menu. */
export function attachCrewReorder(node: HTMLElement, id: string, reorder: CrewReorder): void {
  node.setAttribute('aria-keyshortcuts', 'Control+Shift+PageUp Control+Shift+PageDown');
  attachKeys(node, id, reorder);
  attachDrag(node, id, reorder);
}
