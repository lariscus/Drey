// i18n: catalog
/**
 * The Skills block (R11, req-137's page half): one row per skill — its name
 * and path, shared or own with its token estimate, a switch. A switch on =
 * the name is in the record's `skills:`, saved with the page's one Save.
 * `Add skill…` joins the head with the upload route (req-172, req-237).
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead } from './persona-dom';
import { skillLinesOf, skillsToggled, type SkillLine } from './persona-skills-model';

function skillRow(ctx: BlockContext, line: SkillLine): HTMLElement {
  const { t } = ctx;
  const row = h('div', 'persona-skill');
  row.dataset['skill'] = line.name;
  const name = h('span', 'persona-grow', line.title);
  if (line.path !== null) {
    name.append(h('code', 'persona-muted persona-mono persona-skill-path', line.path));
  }
  const meta = line.origin === null ? '' : line.tokens === null ? t(`persona.skills.${line.origin}`) : t('persona.skills.meta', { origin: t(`persona.skills.${line.origin}`), count: line.tokens });
  const toggle = h('button', `persona-switch${line.on ? ' persona-switch-on' : ''}`);
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(line.on));
  toggle.setAttribute('aria-label', t('persona.skills.switch', { name: line.title }));
  toggle.title = t(line.on ? 'persona.skills.switch_off' : 'persona.skills.switch_on', { name: ctx.draft().title });
  toggle.addEventListener('click', () => ctx.change({ skills: skillsToggled(ctx.draft().skills, line.name, !line.on) }));
  row.append(name, h('span', 'persona-muted persona-skill-meta', meta), toggle);
  return row;
}

export function skillsBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.skills'));
  const list = h('div', 'persona-skill-list');
  list.setAttribute('role', 'list');
  for (const line of skillLinesOf(ctx.loadedSkills, ctx.draft().skills, ctx.extras.skills)) {
    list.append(skillRow(ctx, line));
  }
  block.append(blockHead(t('persona.page.skills')), list);
  return block;
}
