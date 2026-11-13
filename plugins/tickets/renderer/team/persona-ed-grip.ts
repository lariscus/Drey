// i18n: catalog
/**
 * The splitter under the Instructions editor (D-66, the owner's interim
 * verification 2026-11-13): drag it to give the editor a height of its
 * own, Arrow Up / Down steps it, a double-click hands the height back to
 * the page. The height is one value per machine, like the Ready card's
 * splitter. D-70: it is a minimum, not a fixed height — the editor still
 * fills whatever room the column has, and the dragged height only makes
 * it taller than that (the column then scrolls).
 */
import { h } from '../desk-deps';

export const INSTRUCTIONS_HEIGHT_KEY = 'drey.tickets.personaInstructionsHeight';
/** The editor never gets smaller than this, by drag or by key. */
export const INSTRUCTIONS_MIN_HEIGHT = 160;
const KEY_STEP = 32;

export interface EditorGrip {
  readonly element: HTMLElement;
}

function remember(px: number | null): void {
  try {
    if (px === null) {
      localStorage.removeItem(INSTRUCTIONS_HEIGHT_KEY);
    } else {
      localStorage.setItem(INSTRUCTIONS_HEIGHT_KEY, String(px));
    }
  } catch {
    // storage unavailable: the height just is not remembered
  }
}

function remembered(): number | null {
  try {
    const stored = Number(localStorage.getItem(INSTRUCTIONS_HEIGHT_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** Gives `frame` a minimum height; `null` leaves it to the stylesheet's minimum again. */
function sizeFrame(frame: HTMLElement, px: number | null): number | null {
  if (px === null) {
    frame.style.minHeight = '';
    frame.classList.remove('persona-ed-sized');
    return null;
  }
  const clamped = Math.max(INSTRUCTIONS_MIN_HEIGHT, Math.round(px));
  frame.style.minHeight = `${clamped}px`;
  frame.classList.add('persona-ed-sized');
  return clamped;
}

export function createEditorGrip(frame: HTMLElement, label: string): EditorGrip {
  const grip = h('div', 'persona-ed-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', label);
  grip.tabIndex = 0;
  sizeFrame(frame, remembered());

  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    grip.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    const startH = frame.getBoundingClientRect().height;
    const onMove = (move: PointerEvent): void => void sizeFrame(frame, startH + (move.clientY - startY));
    const onUp = (): void => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      remember(sizeFrame(frame, frame.getBoundingClientRect().height));
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
  grip.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowUp' ? -KEY_STEP : event.key === 'ArrowDown' ? KEY_STEP : 0;
    if (step !== 0) {
      event.preventDefault();
      remember(sizeFrame(frame, frame.getBoundingClientRect().height + step));
    }
  });
  grip.addEventListener('dblclick', () => remember(sizeFrame(frame, null)));
  return { element: grip };
}
