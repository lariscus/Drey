// i18n: catalog
/** The Profile block (R11): the picture, the name, the role, the one line for the crew list. */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { avatarNode, blockHead, labelled, selectOf, textInput } from './persona-dom';
import { ROLE_OPTIONS } from './persona-model';
import { roleLabel } from './team-model';

/** The one line stays one line: the record holds at most this many characters (the engine refuses more). */
export const SUMMARY_MAX = 200;

export function profileBlock(ctx: BlockContext): HTMLElement {
  const { t } = ctx;
  const draft = ctx.draft();
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.profile'));
  const picture = h('div', 'persona-profile-row');
  picture.append(avatarNode('persona-avatar persona-avatar-profile', draft.title, ctx.persona.color));
  const roles = ROLE_OPTIONS.map((role) => ({ value: roleLabel(role), label: t(`persona.role.${role}`) }));
  const role = selectOf(roles, draft.role, (value) => ctx.edit({ role: value }));
  role.dataset['field'] = 'role';
  const summary = textInput(draft.summary, (value) => ctx.edit({ summary: value }), 'summary');
  summary.maxLength = SUMMARY_MAX;
  block.append(
    blockHead(t('persona.page.profile')),
    picture,
    labelled(t('persona.page.name'), textInput(draft.title, (value) => ctx.edit({ title: value }), 'title')),
    labelled(t('persona.page.role'), role),
    labelled(t('persona.page.summary'), summary),
  );
  return block;
}
