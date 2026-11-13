// i18n: catalog
/**
 * The page's head (R11, board 7k v4): the picture, the name and the role
 * (`Mission Control` for her), the facts after them (state, today's cost,
 * Pause — `persona-head-facts.ts`); at the right the save state and Back to
 * Crew. The Save and Discard sit in the footer.
 */
import type { I18n } from '../../../../shared/i18n/types';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { avatarNode, outlineButton } from './persona-dom';
import { headFacts, type HeadFacts } from './persona-head-facts';
import { roleLabel } from './team-model';

export interface PersonaHead {
  readonly element: HTMLElement;
  /** The "Saved" / "Changed" text the page keeps current. */
  readonly state: HTMLElement;
  readonly facts: HeadFacts;
}

/** `Saved · committed 2 days ago` (req-239, from the persona folder's last commit; relative time is `Intl`'s); plain `Saved` where git knows no commit. */
export function savedTextOf(i18n: I18n, committedAt: string | null): string {
  const at = committedAt === null ? Number.NaN : Date.parse(committedAt);
  return Number.isNaN(at) ? i18n.t('persona.page.saved') : i18n.t('persona.page.saved_at', { when: i18n.formatRelative(new Date(at)) });
}

export function personaHead(ctx: BlockContext, back: () => void, pause: (paused: boolean) => void): PersonaHead {
  const { t } = ctx;
  const draft = ctx.draft();
  const head = h('header', 'persona-head');
  const names = h('div', 'persona-head-names');
  names.append(h('b', 'persona-head-name', draft.title), h('span', 'persona-muted', ctx.persona.kind === 'mission' ? t('persona.head.mission') : roleLabel(ctx.persona.role)));
  const facts = headFacts(ctx, pause);
  const state = h('span', 'persona-muted persona-state');
  head.append(avatarNode('persona-avatar persona-avatar-head', draft.title, ctx.persona.color, ctx.persona.id), names, facts.element, h('span', 'persona-grow'), state, outlineButton(t('persona.page.back'), 'persona-back', back));
  return { element: head, state, facts };
}
