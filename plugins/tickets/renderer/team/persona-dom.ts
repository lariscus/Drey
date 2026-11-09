// i18n: catalog
/**
 * The small DOM pieces the Persona page's blocks share: buttons, labelled
 * fields, selects, the persona's avatar. Plain DOM, no state.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { MessageKey } from '../../../../shared/i18n/types';
import { h } from '../desk-deps';
import type { Choice } from './persona-allowed-model';
import { initialsOf } from './team-model';

export type Translate = DreyPluginApi['i18n']['t'];

export function outlineButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = h('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

/** An icon-only control: always a title and an aria-label (ADR-0057). */
export function iconButton(api: DreyPluginApi, icon: string, label: string, onClick: () => void, size = 14): HTMLButtonElement {
  const button = h('button', 'persona-icon-btn');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(api.ui.icon(icon, size));
  button.addEventListener('click', onClick);
  return button;
}

export function avatarNode(className: string, title: string, color: string): HTMLElement {
  const node = h('span', className, initialsOf(title));
  node.setAttribute('aria-hidden', 'true');
  node.style.setProperty('--persona-color', color);
  return node;
}

/** A block's heading: the title, and where the mockup has one the control at its right. */
export function blockHead(title: string, ...controls: readonly (HTMLElement | null)[]): HTMLElement {
  const head = h('div', 'persona-block-head');
  head.append(h('b', 'persona-title', title), h('span', 'persona-grow'), ...controls.filter((node): node is HTMLElement => node !== null));
  return head;
}

/** A label over a control: one `<label>` for a form control, a plain group where the control holds several buttons. */
export function labelled(label: string, control: HTMLElement, className = ''): HTMLElement {
  const isField = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
  const wrap = h(isField ? 'label' : 'div', `persona-field${className === '' ? '' : ` ${className}`}`);
  wrap.append(h('span', 'persona-muted', label), control);
  return wrap;
}

export function textInput(value: string, onInput: (value: string) => void, field?: string): HTMLInputElement {
  const input = h('input', 'persona-input');
  input.type = 'text';
  input.value = value;
  if (field !== undefined) {
    input.dataset['field'] = field;
  }
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function selectOf(options: readonly { readonly value: string; readonly label: string }[], value: string, onChange: (value: string) => void, className = 'persona-select'): HTMLSelectElement {
  const select = h('select', className);
  for (const option of options) {
    const node = h('option', undefined, option.label);
    node.value = option.value;
    select.append(node);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

/** The choices of a model file, labels read through the catalog. */
export function choiceOptions(t: Translate, choices: readonly Choice[]): readonly { readonly value: string; readonly label: string }[] {
  return choices.map((choice) => ({ value: choice.value, label: t(choice.label as MessageKey) }));
}
