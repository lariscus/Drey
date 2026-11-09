// i18n: catalog
/**
 * The Skills block (R11; over the engine's routes since req-237): one row
 * for every skill of the persona's own folder and the shared pool — name
 * and path, shared or own with its estimated tokens, a switch, and on an
 * own skill the `⋯` menu with Remove — with the counts after the title and
 * `Add skill…` at the right. A switch, a removal and an upload each go to
 * the engine at once and come back as the new listing (one commit each); they
 * are not part of the page's Save. Like the Instructions block this one is
 * built once per load and repaints itself from `PersonaSkillsState`.
 */
import { h } from '../desk-deps';
import type { BlockContext } from './persona-block-context';
import { blockHead } from './persona-dom';
import { skillAddControl } from './persona-skill-add';
import { skillRowNode } from './persona-skill-row';
import { failureTextOf, skillCountsOf, skillRowsOf } from './persona-skills-model';
import { uploadPlanOf } from './skill-upload-model';

export interface SkillsBlock {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createSkillsBlock(ctx: BlockContext): SkillsBlock {
  const { t, api } = ctx;
  const state = ctx.skills;
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.skills'));
  const counts = h('small', 'persona-muted persona-tokens persona-skill-counts');
  const list = h('div', 'persona-skill-list');
  list.setAttribute('role', 'list');
  const problem = h('div', 'persona-note persona-state-error persona-skill-problem');
  problem.setAttribute('role', 'alert');
  let confirming: string | null = null;

  const add = skillAddControl(t, (kind, files) => {
    void uploadPlanOf(kind, files)
      .then((plan) => (plan.ok ? state.upload(plan.command) : state.fail({ ok: false, code: plan.code, error: '' })))
      .catch(() => state.fail({ ok: false, code: 'internal', error: '' }));
  });

  const paint = (): void => {
    const listing = state.list;
    const rows = listing === null ? [] : skillRowsOf(listing, ctx.persona.id);
    if (confirming !== null && !rows.some((row) => row.name === confirming)) {
      confirming = null;
    }
    list.replaceChildren(
      ...rows.map((row) =>
        skillRowNode(api, t, row, {
          persona: ctx.draft().title,
          busy: state.busy,
          confirming: confirming === row.name,
          toggle: (name, on) => void state.toggle(name, on),
          askRemove: (name) => {
            confirming = name;
            paint();
          },
          cancelRemove: () => {
            confirming = null;
            paint();
          },
          remove: (name) => {
            confirming = null;
            void state.remove(name);
          },
        }),
      ),
    );
    if (listing === null) {
      counts.textContent = '';
    } else {
      const total = skillCountsOf(listing);
      counts.textContent = t('persona.skills.count', { on: total.on, total: total.total, tokens: total.tokens });
    }
    const failure = state.failure;
    problem.textContent = failure === null ? '' : failureTextOf(t, failure);
    problem.hidden = failure === null;
    add.setBusy(state.busy);
  };

  const off = state.subscribe(paint);
  block.append(blockHead(t('persona.page.skills'), counts, add.element), problem, list);
  paint();
  return { element: block, dispose: off };
}
