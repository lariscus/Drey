// i18n: catalog
/**
 * One row of the Skills block (R11; board 7k v3, req-288): the switch, the
 * skill's name with an *update available* tag when its source has a newer
 * ref, the source line (`shared · test-first`), the tokens a run loads and the
 * remove button, which takes the skill off the persona — the library keeps
 * it, an own skill stays in the persona's folder and in the library list.
 */
import { h } from '../desk-deps';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { switchButton } from './persona-controls';
import type { Translate } from './persona-dom';
import { iconButton } from './persona-dom';
import type { SkillRow } from './persona-skills-model';

export interface SkillRowActions {
  /** The persona's name, for the labels. */
  readonly persona: string;
  readonly busy: boolean;
  toggle(name: string, on: boolean): void;
}

/** The name and the source line, the update tag beside the name. */
function nameOf(t: Translate, row: SkillRow): HTMLElement {
  const name = h('span', 'persona-grow persona-skill-name');
  if (row.description !== '') {
    name.title = row.description;
  }
  const title = h('span', 'persona-skill-title', row.title);
  if (row.source.updateAvailable) {
    title.append(h('span', 'persona-skill-update', t('persona.skills.update')));
  }
  const line = row.origin === null ? t('persona.skills.missing') : row.source.line;
  name.append(title, h('span', 'persona-mono persona-muted persona-skill-line', line));
  return name;
}

export function skillRowNode(api: DreyPluginApi, t: Translate, row: SkillRow, actions: SkillRowActions): HTMLElement {
  const node = h('div', 'persona-skill');
  node.dataset['skill'] = row.name;
  node.setAttribute('role', 'listitem');
  const toggle = switchButton(t('persona.skills.switch', { name: row.title }), row.on, () => actions.toggle(row.name, !row.on), {
    title: t(row.on ? 'persona.skills.switch_off' : 'persona.skills.switch_on', { name: actions.persona }),
  });
  toggle.disabled = actions.busy;
  const remove = iconButton(api, 'x', t('persona.skills.remove_named', { name: row.title }), () => actions.toggle(row.name, false));
  remove.title = t('persona.skills.remove_from', { name: actions.persona });
  remove.disabled = actions.busy;
  node.append(toggle, nameOf(t, row));
  if (row.tokens !== null) {
    node.append(h('span', 'persona-muted persona-skill-tokens', t('persona.skills.tokens', { count: row.tokens })));
  }
  node.append(remove);
  return node;
}
