// i18n: catalog
/**
 * Settings → Models' DOM vocabulary (board 7l v3): the board's glyphs, the
 * − N + stepper, a select and the Add / Cancel buttons. Plain DOM, no state.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { el } from './dom.ts/settings-dom';

const GLYPH = {
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 10l3 2-3 2M12 15h5"></path>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  grip: '<circle cx="9" cy="6" r="1"></circle><circle cx="15" cy="6" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="9" cy="18" r="1"></circle><circle cx="15" cy="18" r="1"></circle>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3z"></path>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="M21 16l-5-5-8 9"></path>',
  down: '<path d="M6 9l6 6 6-6"></path>',
  right: '<path d="M9 6l6 6-6 6"></path>',
  check: '<path d="M5 12l4 4L19 6"></path>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>',
  close: '<path d="M18 6L6 18M6 6l12 12"></path>',
} as const;

export type GlyphName = keyof typeof GLYPH;

export function glyph(name: GlyphName, size: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = GLYPH[name];
  return svg;
}

type Translate = DreyPluginApi['i18n']['t'];

/** An icon-only button: the glyph, a title and an aria-label. */
export function iconButton(name: GlyphName, size: number, label: string, className = 'mdl-ib'): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(glyph(name, size));
  return button;
}

export function textButton(label: string, kind: '' | 'primary' | 'warn' | 'dashed' = '', small = true): HTMLButtonElement {
  const classes = ['mdl-bt', ...(small ? ['mdl-bs'] : []), ...(kind === '' ? [] : [`mdl-bt-${kind}`])];
  const button = el('button', classes.join(' '), label);
  button.type = 'button';
  return button;
}

/** A button with a leading glyph (`+ Add class`). */
export function glyphButton(name: GlyphName, label: string, kind: '' | 'dashed' = ''): HTMLButtonElement {
  const button = textButton('', kind);
  button.append(glyph(name, 14), label);
  return button;
}

export interface Stepper {
  readonly root: HTMLElement;
}

/** `− 6 +`: `shown` is what sits between; `onStep` gets the direction. */
export function stepper(t: Translate, shown: string, title: string, onStep: (delta: 1 | -1) => void, tall = false): Stepper {
  const root = el('span', tall ? 'mdl-step mdl-step-tall' : 'mdl-step');
  root.title = title;
  const down = el('button', undefined, '−');
  down.type = 'button';
  down.setAttribute('aria-label', `${title}: ${t('tickets.settings.models.step_down')}`);
  const up = el('button', undefined, '+');
  up.type = 'button';
  up.setAttribute('aria-label', `${title}: ${t('tickets.settings.models.step_up')}`);
  down.addEventListener('click', () => onStep(-1));
  up.addEventListener('click', () => onStep(1));
  root.append(down, el('b', undefined, shown), up);
  return { root };
}

export function selectOf(options: readonly { readonly value: string; readonly label: string }[], value: string, label: string, className = 'mdl-fld'): HTMLSelectElement {
  const select = el('select', className);
  for (const option of options) {
    select.append(Object.assign(el('option', undefined, option.label), { value: option.value }));
  }
  select.value = value;
  select.setAttribute('aria-label', label);
  return select;
}

export function textField(value: string, label: string, className = 'mdl-fld'): HTMLInputElement {
  const input = el('input', className);
  input.type = 'text';
  input.spellcheck = false;
  input.value = value;
  input.setAttribute('aria-label', label);
  return input;
}

/** The row-of-a-group heading: `<h2>` and what sits right of it. */
export function groupHead(title: string, ...right: HTMLElement[]): HTMLElement {
  const head = el('div', 'mdl-grouphead');
  head.append(el('h2', 'mdl-h2', title), el('span', 'mdl-grow'), ...right);
  return head;
}

/** A small label above its control (the add rows' fields). */
export function labelled(text: string, control: HTMLElement): HTMLElement {
  const field = el('label', 'mdl-lab');
  field.append(text, control);
  return field;
}

/** Runs `enter` on Enter and `cancel` on Escape in a field. */
export function onEnterEscape(control: HTMLElement, enter: () => void, escape: () => void): void {
  control.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      enter();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      escape();
    }
  });
}
