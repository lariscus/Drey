// i18n: catalog
/**
 * The Proposals block (R11; the Friction card, renamed): the persona's open
 * improvement proposal — raised from the journal's findings and the 1:1 —
 * with Show diff / Dismiss / Apply over the existing improvements routes
 * (`personaImprovementDecide`), and under it the links to the Crew detail's
 * Memory and 1:1 tabs, which stay where they are.
 */
import type { ImprovementProposal } from '../../../../packages/tickets-engine/src/core/improvements';
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead, outlineButton } from './persona-dom';

export interface ProposalsView {
  /** The first open proposal, if any. */
  readonly proposal: ImprovementProposal | null;
  readonly memory: number | null;
  readonly journal: number | null;
  /** Applying a prompt proposal rewrites `prompt.md`: not while the page holds unsaved text. */
  readonly promptDirty: boolean;
  decide(proposal: ImprovementProposal, decision: 'accepted' | 'dismissed'): void;
  openCrew(tab: 'Memory' | '1:1'): void;
}

/** Applying a prompt proposal rewrites `prompt.md`: the Apply button waits while the page holds unsaved instructions. The page calls this on every edit. */
export function syncApply(scope: ParentNode, blocked: boolean, title: string): void {
  const apply = scope.querySelector<HTMLButtonElement>('[data-proposal][data-target="prompt.md"] .persona-btn-primary');
  if (apply !== null) {
    apply.disabled = blocked;
    apply.title = blocked ? title : '';
  }
}

function card(ctx: BlockContext, view: ProposalsView, open: ImprovementProposal): HTMLElement {
  const { t } = ctx;
  const node = h('div', 'persona-card');
  node.dataset['proposal'] = open.id;
  node.dataset['target'] = open.target;
  const text = h('span', 'persona-grow');
  text.append(h('b', 'persona-line', open.title), h('span', 'persona-muted persona-line', t('persona.proposals.meta', { count: open.evidence.length })));
  const buttons = h('span', 'persona-card-buttons');
  if (open.target === 'prompt.md') {
    buttons.append(
      outlineButton(t('persona.page.show_diff'), 'persona-btn persona-btn-28', () => {
        void ctx.api.ui.showDiff({ title: open.title, path: ctx.paths.promptShort, before: ctx.draft().prompt, after: open.content, beforeLabel: t('persona.page.diff_now'), afterLabel: t('persona.page.diff_suggested') });
      }),
    );
  }
  const apply = outlineButton(t('persona.proposals.apply'), 'persona-btn persona-btn-28 persona-btn-primary', () => view.decide(open, 'accepted'));
  buttons.append(outlineButton(t('persona.page.dismiss'), 'persona-btn persona-btn-28', () => view.decide(open, 'dismissed')), apply);
  node.append(text, buttons);
  if (open.target === 'prompt.md' && view.promptDirty) {
    apply.disabled = true;
    apply.title = t('persona.proposals.apply_blocked');
  }
  return node;
}

function links(ctx: BlockContext, view: ProposalsView): HTMLElement {
  const { t } = ctx;
  const row = h('div', 'persona-links');
  const link = (text: string, run: () => void): void => {
    row.append(outlineButton(text, 'persona-link', run));
  };
  link(view.memory === null ? t('persona.links.memory') : t('persona.links.memory_count', { count: view.memory }), () => view.openCrew('Memory'));
  link(view.journal === null ? t('persona.links.journal') : t('persona.links.journal_count', { count: view.journal }), () => view.openCrew('Memory'));
  link(t('persona.links.talk', { name: ctx.draft().title }), () => view.openCrew('1:1'));
  return row;
}

export function proposalsBlock(ctx: BlockContext, view: ProposalsView): HTMLElement {
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', ctx.t('persona.proposals.title'));
  block.append(blockHead(ctx.t('persona.proposals.title')));
  if (view.proposal !== null) {
    block.append(card(ctx, view, view.proposal));
  }
  block.append(links(ctx, view));
  return block;
}
