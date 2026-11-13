// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS_HEIGHT_KEY, INSTRUCTIONS_MIN_HEIGHT, createEditorGrip } from './persona-ed-grip';

/** jsdom does no layout: the frame reports the minimum height its inline style says. */
function frameOf(): HTMLElement {
  const frame = document.createElement('div');
  frame.getBoundingClientRect = () => ({ height: Number.parseFloat(frame.style.minHeight) || 0 }) as DOMRect;
  document.body.append(frame);
  return frame;
}

function pointer(type: string, clientY: number): PointerEvent {
  const event = new MouseEvent(type, { button: 0, clientY, bubbles: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

describe('the Instructions editor splitter (D-66)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.body.replaceChildren());

  it('is a focusable horizontal separator with its label', () => {
    const grip = createEditorGrip(frameOf(), 'Resize the instructions').element;
    expect(grip.getAttribute('role')).toBe('separator');
    expect(grip.getAttribute('aria-orientation')).toBe('horizontal');
    expect(grip.getAttribute('aria-label')).toBe('Resize the instructions');
    expect(grip.tabIndex).toBe(0);
  });

  it('leaves the frame to the stylesheet until a height was set', () => {
    const frame = frameOf();
    createEditorGrip(frame, 'x');
    expect(frame.style.minHeight).toBe('');
    expect(frame.classList.contains('persona-ed-sized')).toBe(false);
  });

  it('a drag gives the frame a minimum height and remembers it (D-70: the frame still fills the free room)', () => {
    const frame = frameOf();
    const grip = createEditorGrip(frame, 'x').element;
    frame.style.minHeight = '300px';
    grip.dispatchEvent(pointer('pointerdown', 100));
    grip.dispatchEvent(pointer('pointermove', 180));
    expect(frame.style.minHeight).toBe('380px');
    grip.dispatchEvent(pointer('pointerup', 180));
    expect(frame.classList.contains('persona-ed-sized')).toBe(true);
    expect(localStorage.getItem(INSTRUCTIONS_HEIGHT_KEY)).toBe('380');
  });

  it('never goes below the minimum', () => {
    const frame = frameOf();
    const grip = createEditorGrip(frame, 'x').element;
    frame.style.minHeight = '200px';
    grip.dispatchEvent(pointer('pointerdown', 400));
    grip.dispatchEvent(pointer('pointermove', 0));
    expect(frame.style.minHeight).toBe(`${INSTRUCTIONS_MIN_HEIGHT}px`);
  });

  it('Arrow Down and Up step the height', () => {
    const frame = frameOf();
    const grip = createEditorGrip(frame, 'x').element;
    frame.style.minHeight = '300px';
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(frame.style.minHeight).toBe('332px');
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(frame.style.minHeight).toBe('300px');
  });

  it('a double-click hands the height back to the page and forgets it', () => {
    localStorage.setItem(INSTRUCTIONS_HEIGHT_KEY, '420');
    const frame = frameOf();
    const grip = createEditorGrip(frame, 'x').element;
    expect(frame.style.minHeight).toBe('420px');
    grip.dispatchEvent(new MouseEvent('dblclick'));
    expect(frame.style.minHeight).toBe('');
    expect(frame.classList.contains('persona-ed-sized')).toBe(false);
    expect(localStorage.getItem(INSTRUCTIONS_HEIGHT_KEY)).toBeNull();
  });
});
