// i18n: catalog
/**
 * Settings → Skills library's DOM vocabulary (board 7o): the board's glyphs
 * beside the Models page's (`models-dom.ts`), a small menu, the in-row
 * question before a removal and a persona's circle. Plain DOM, no state.
 */
import { el } from '../settings-dom';
import { personaPictures } from '../team/persona-pictures';
import { textButton } from './models-dom';

const GLYPH = {
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"></path>',
  branch: '<circle cx="6" cy="6" r="2"></circle><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="8" r="2"></circle><path d="M6 8v8M18 10c0 4-6 3-12 6"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>',
  more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>',
} as const;

export type SkillGlyph = keyof typeof GLYPH;

export function skillGlyph(name: SkillGlyph, size: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(key, String(value));
  }
  svg.innerHTML = GLYPH[name];
  return svg;
}

/** An icon-only button with a title and an aria-label (ADR-0057). */
export function skillIconButton(name: SkillGlyph, size: number, label: string): HTMLButtonElement {
  const button = el('button', 'mdl-ib mdl-ib-28');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(skillGlyph(name, size));
  return button;
}

/** A text button with the glyph before its label (`Upload skill…`, `Add from GitHub`). */
export function glyphTextButton(name: SkillGlyph, label: string, kind: '' | 'dashed'): HTMLButtonElement {
  const button = textButton('', kind, false);
  button.append(skillGlyph(name, 14), label);
  return button;
}

export interface MenuItem {
  readonly label: string;
  readonly run: () => void;
}

/** An opener and its menu below it; a click outside closes it. */
export function menuOf(opener: HTMLButtonElement, items: readonly MenuItem[]): HTMLElement {
  const wrap = el('span', 'skl-menuwrap');
  const menu = el('div', 'skl-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const close = (): void => {
    menu.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (event: Event): void => {
    if (!wrap.contains(event.target as Node)) {
      close();
    }
  };
  for (const item of items) {
    const button = el('button', 'skl-menuitem', item.label);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      close();
      item.run();
    });
    menu.append(button);
  }
  opener.setAttribute('aria-haspopup', 'menu');
  opener.setAttribute('aria-expanded', 'false');
  opener.addEventListener('click', () => {
    if (menu.hidden) {
      menu.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
    } else {
      close();
    }
  });
  wrap.append(opener, menu);
  return wrap;
}

export interface ConfirmSpec {
  readonly question: string;
  readonly keep: string;
  readonly go: string;
  readonly busy: boolean;
  onKeep(): void;
  onGo(): void;
}

/** The row's question before a removal: the sentence, Keep and the destructive button. */
export function confirmRow(spec: ConfirmSpec): HTMLElement {
  const row = el('div', 'mdl-row skl-confirm');
  row.setAttribute('role', 'alertdialog');
  row.setAttribute('aria-label', spec.question);
  const keep = textButton(spec.keep);
  keep.addEventListener('click', () => spec.onKeep());
  const go = textButton(spec.go, 'warn');
  go.disabled = spec.busy;
  go.addEventListener('click', () => spec.onGo());
  row.append(el('span', 'mdl-grow', spec.question), keep, go);
  return row;
}

/** A persona's circle in Used by: its picture when it has one, else its initial on its colour. */
export function userCircle(id: string, title: string, color: string): HTMLElement {
  const node = el('span', 'skl-user', [...title.trim()][0]?.toUpperCase() ?? '?');
  node.title = title;
  node.style.setProperty('--persona-color', color);
  personaPictures.paint(node, id, title);
  return node;
}
