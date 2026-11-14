// i18n: catalog
/**
 * The Persona page's v3 controls (req-288, board 7k v3): a switch, the
 * segmented class choice and a listbox that opens under its button — the
 * board's Model choice and the Skills library. Plain DOM; a control draws and
 * calls back, the block owns the state.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { h } from '../desk-deps';

/** A switch button (`role="switch"`); `large` is the board's 44 × 24 one (Read-only). */
export function switchButton(label: string, on: boolean, toggle: () => void, options: { readonly large?: boolean; readonly title?: string; readonly field?: string } = {}): HTMLButtonElement {
  const button = h('button', `persona-switch${options.large === true ? ' persona-switch-lg' : ''}${on ? ' persona-switch-on' : ''}`);
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(on));
  button.setAttribute('aria-label', label);
  if (options.title !== undefined) {
    button.title = options.title;
  }
  if (options.field !== undefined) {
    button.dataset['field'] = options.field;
  }
  button.addEventListener('click', toggle);
  return button;
}

/** The segmented choice (`role="radiogroup"`): one button per value, the chosen one marked. */
export function segmented(label: string, values: readonly string[], chosen: string, pick: (value: string) => void): HTMLElement {
  const group = h('div', 'persona-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const value of values) {
    const button = h('button', `persona-seg-btn${value === chosen ? ' persona-seg-on' : ''}`, value);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === chosen));
    button.dataset['value'] = value;
    button.addEventListener('click', () => pick(value));
    group.append(button);
  }
  return group;
}

/** One option of a listbox: its value, what it shows, whether it is chosen; `separator` draws a line above it. */
export interface ListOption {
  readonly value: string;
  readonly content: readonly (string | Node)[];
  readonly selected: boolean;
  readonly separator?: boolean;
  /** Leaves room for the check mark the chosen option draws (the board indents the model rows). */
  readonly indent?: boolean;
}

/** The check mark of a chosen option, or the room it takes. */
function checkOf(api: DreyPluginApi, selected: boolean): Node {
  if (!selected) {
    return h('span', 'persona-op-check');
  }
  const mark = api.ui.icon('check', 14);
  mark.classList.add('persona-op-check');
  return mark;
}

/** A listbox's options (`role="listbox"`), each a button that picks its value. */
export function listboxOf(api: DreyPluginApi, label: string, options: readonly ListOption[], pick: (value: string) => void): HTMLElement {
  const list = h('div', 'persona-listbox');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  for (const option of options) {
    if (option.separator === true) {
      const line = h('div', 'persona-op-sep');
      line.setAttribute('role', 'separator');
      list.append(line);
    }
    const item = h('button', `persona-op${option.selected ? ' persona-op-on' : ''}${option.indent === true ? ' persona-op-indent' : ''}`);
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.dataset['value'] = option.value;
    item.append(...(option.indent === true && !option.selected ? [] : [checkOf(api, option.selected)]), ...option.content);
    item.addEventListener('click', () => pick(option.value));
    list.append(item);
  }
  return list;
}

/**
 * A field that opens a listbox under itself (the board's Model choice): the
 * button shows the chosen option's text and a chevron; Escape or a click
 * outside closes it. `open` survives a repaint when the block passes it back.
 */
export function pickerField(api: DreyPluginApi, label: string, shown: readonly (string | Node)[], listbox: () => HTMLElement, state: { open: boolean; field?: string }): HTMLElement {
  const wrap = h('div', 'persona-picker');
  const button = h('button', 'persona-picker-btn');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-label', label);
  if (state.field !== undefined) {
    button.dataset['field'] = state.field;
  }
  const text = h('span', 'persona-grow persona-picker-text');
  text.append(...shown);
  const chevron = api.ui.icon('chevron-down', 14);
  chevron.classList.add('persona-picker-chevron');
  button.append(text, chevron);
  let popup: HTMLElement | null = null;
  const close = (): void => {
    popup?.remove();
    popup = null;
    state.open = false;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (event: MouseEvent): void => {
    if (!wrap.contains(event.target as Node)) {
      close();
    }
  };
  const open = (): void => {
    popup = listbox();
    wrap.append(popup);
    state.open = true;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside, true);
  };
  button.addEventListener('click', () => (popup === null ? open() : close()));
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popup !== null) {
      event.stopPropagation();
      close();
      button.focus();
    }
  });
  button.setAttribute('aria-expanded', 'false');
  wrap.append(button);
  if (state.open) {
    open();
  }
  return wrap;
}
