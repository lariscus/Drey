// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCrewReorder, droppedOrder, movedOrder, withOthersKept, type CrewReorder } from './crew-reorder';

const IDS = ['paul', 'ben', 'ralf', 'tessa'];

describe('the crew order (req-258)', () => {
  it('moves one place left or right, and stays at an edge', () => {
    expect(movedOrder(IDS, 'ben', -1)).toEqual(['ben', 'paul', 'ralf', 'tessa']);
    expect(movedOrder(IDS, 'ben', 1)).toEqual(['paul', 'ralf', 'ben', 'tessa']);
    expect(movedOrder(IDS, 'paul', -1)).toEqual(IDS);
    expect(movedOrder(IDS, 'tessa', 1)).toEqual(IDS);
  });

  it('drops before or after the target card', () => {
    expect(droppedOrder(IDS, 'tessa', 'ben', false)).toEqual(['paul', 'tessa', 'ben', 'ralf']);
    expect(droppedOrder(IDS, 'paul', 'ralf', true)).toEqual(['ben', 'ralf', 'paul', 'tessa']);
    expect(droppedOrder(IDS, 'ben', 'ben', true)).toEqual(IDS);
  });

  it('keeps the human, who has no card, in its place', () => {
    expect(withOthersKept(['paul', 'ben', 'you', 'ralf'], ['ben', 'paul', 'ralf'])).toEqual(['ben', 'paul', 'you', 'ralf']);
    expect(withOthersKept(['you', 'paul', 'ben'], ['ben', 'paul'])).toEqual(['you', 'ben', 'paul']);
  });
});

describe('a reorderable card', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function card(id: string, reorder: CrewReorder): HTMLElement {
    const node = document.createElement('article');
    node.dataset['persona'] = id;
    node.tabIndex = 0;
    attachCrewReorder(node, id, reorder);
    document.body.append(node);
    return node;
  }

  function rig(): { reorder: CrewReorder; apply: ReturnType<typeof vi.fn> } {
    const apply = vi.fn();
    return { apply, reorder: { t: (key: string) => (key === 'tickets.team.move_left' ? 'Move left' : 'Move right'), ids: () => IDS, apply } as unknown as CrewReorder };
  }

  it('moves with Ctrl+Shift+PageUp and PageDown, keeping the focus on the moved card', () => {
    const { reorder, apply } = rig();
    const node = card('ben', reorder);
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(apply).toHaveBeenCalledWith(['paul', 'ralf', 'ben', 'tessa'], 'ben');
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(apply).toHaveBeenLastCalledWith(['ben', 'paul', 'ralf', 'tessa'], 'ben');
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    expect(apply).toHaveBeenCalledTimes(2); // Alt+Left stays the app's Go back
  });

  it('opens Move left / Move right from the context menu, the first card unable to move left', () => {
    const { reorder, apply } = rig();
    const node = card('paul', reorder);
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const items = [...document.querySelectorAll<HTMLButtonElement>('.crew-order-menu button')];
    expect(items.map((item) => [item.textContent, item.disabled])).toEqual([
      ['Move left', true],
      ['Move right', false],
    ]);
    items[1]!.click();
    expect(apply).toHaveBeenCalledWith(['ben', 'paul', 'ralf', 'tessa'], 'paul');
    expect(document.querySelector('.crew-order-menu')).toBeNull();
  });

  it('the context-menu key opens the same menu', () => {
    const { reorder } = rig();
    const node = card('ralf', reorder);
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    expect(document.querySelectorAll('.crew-order-menu button')).toHaveLength(2);
  });
});
