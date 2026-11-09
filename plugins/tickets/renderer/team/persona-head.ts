// i18n: catalog
/**
 * The page's head (R11): the picture, the name, the role with the persona's
 * folder and the counts of memory, journal and open proposals; at the right
 * the save state and Back to Crew. The Save and Discard sit in the footer.
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { avatarNode, outlineButton } from './persona-dom';
import { roleLabel } from './team-model';

export interface PersonaHead {
  readonly element: HTMLElement;
  /** The "Saved" / "Changed" text the page keeps current. */
  readonly state: HTMLElement;
}

export interface HeadCounts {
  readonly memory: number | null;
  readonly journal: number | null;
  readonly proposals: number;
}

export function personaHead(ctx: BlockContext, counts: HeadCounts, back: () => void): PersonaHead {
  const { t } = ctx;
  const draft = ctx.draft();
  const head = h('header', 'persona-head');
  const names = h('div', 'persona-head-names');
  const unknown = '–';
  const sub = t('persona.head.sub', {
    role: roleLabel(ctx.persona.role),
    path: ctx.paths.dirShort,
    memory: counts.memory === null ? unknown : counts.memory,
    journal: counts.journal === null ? unknown : counts.journal,
    proposals: counts.proposals,
  });
  names.append(h('b', 'persona-head-name', draft.title), h('span', 'persona-muted', sub));
  const state = h('span', 'persona-muted persona-state');
  head.append(avatarNode('persona-avatar persona-avatar-head', draft.title, ctx.persona.color), names, h('span', 'persona-grow'), state, outlineButton(t('persona.page.back'), 'persona-back', back));
  return { element: head, state };
}
