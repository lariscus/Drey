// i18n: catalog
/**
 * One row of the Skills block (R11): the skill's name with its path, where it
 * lives and what it costs, the switch, and — on an own skill only — the `⋯`
 * menu with Remove. A removal asks once, inline, in the row itself (the
 * panel's own pattern for a destructive step: the line and two buttons);
 * a shared skill is never removable from here.
 */
import { h } from '../desk-deps';
import type { Translate } from './persona-dom';
import { iconButton, outlineButton } from './persona-dom';
import type { SkillRow } from './persona-skills-model';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';

export interface SkillRowActions {
  /** The persona's name, for the labels. */
  readonly persona: string;
  readonly busy: boolean;
  toggle(name: string, on: boolean): void;
  /** True while this row asks whether to remove. */
  readonly confirming: boolean;
  askRemove(name: string): void;
  cancelRemove(): void;
  remove(name: string): void;
}

function meta(t: Translate, row: SkillRow): string {
  if (row.origin === null) {
    return t('persona.skills.missing');
  }
  return row.tokens === null ? t(`persona.skills.${row.origin}`) : t('persona.skills.meta', { origin: t(`persona.skills.${row.origin}`), count: row.tokens });
}

function switchOf(t: Translate, row: SkillRow, actions: SkillRowActions): HTMLButtonElement {
  const toggle = h('button', `persona-switch${row.on ? ' persona-switch-on' : ''}`);
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(row.on));
  toggle.setAttribute('aria-label', t('persona.skills.switch', { name: row.title }));
  toggle.title = t(row.on ? 'persona.skills.switch_off' : 'persona.skills.switch_on', { name: actions.persona });
  toggle.disabled = actions.busy;
  toggle.addEventListener('click', () => actions.toggle(row.name, !row.on));
  return toggle;
}

function menuOf(api: DreyPluginApi, t: Translate, row: SkillRow, actions: SkillRowActions): HTMLElement {
  const wrap = h('span', 'persona-menu-wrap');
  const menu = h('div', 'persona-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const remove = outlineButton(t('persona.skills.remove'), 'persona-menu-item', () => {
    menu.hidden = true;
    actions.askRemove(row.name);
  });
  remove.setAttribute('role', 'menuitem');
  menu.append(remove);
  const opener = iconButton(api, 'more-horizontal', t('persona.skills.row_options', { name: row.title }), () => {
    menu.hidden = !menu.hidden;
  });
  opener.setAttribute('aria-haspopup', 'menu');
  opener.disabled = actions.busy;
  wrap.append(opener, menu);
  return wrap;
}

function confirmOf(t: Translate, row: SkillRow, actions: SkillRowActions): HTMLElement {
  const box = h('div', 'persona-confirm');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', t('persona.skills.remove_ask', { name: row.title }));
  const buttons = h('span', 'persona-confirm-row');
  const cancel = outlineButton(t('persona.skills.keep'), 'persona-btn persona-btn-28', () => actions.cancelRemove());
  const remove = outlineButton(t('persona.skills.remove_confirm'), 'persona-btn persona-btn-28 persona-btn-danger', () => actions.remove(row.name));
  remove.disabled = actions.busy;
  buttons.append(cancel, remove);
  box.append(h('span', 'persona-grow', t('persona.skills.remove_ask', { name: row.title })), buttons);
  return box;
}

export function skillRowNode(api: DreyPluginApi, t: Translate, row: SkillRow, actions: SkillRowActions): HTMLElement {
  const node = h('div', 'persona-skill');
  node.dataset['skill'] = row.name;
  node.setAttribute('role', 'listitem');
  if (actions.confirming) {
    node.append(confirmOf(t, row, actions));
    return node;
  }
  const name = h('span', 'persona-grow', row.title);
  if (row.path !== null) {
    name.append(h('code', 'persona-muted persona-mono persona-skill-path', row.path));
  }
  node.append(name, h('span', 'persona-muted persona-skill-meta', meta(t, row)), switchOf(t, row, actions));
  if (row.removable) {
    node.append(menuOf(api, t, row, actions));
  }
  return node;
}
