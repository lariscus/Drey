// i18n: catalog
/**
 * The Skills block (R11; over the engine's routes since req-237; board 7k
 * v3, req-288): the skills the persona carries, one row each
 * (`persona-skill-row.ts`), and *Add from library* at the right — a
 * searchable list of every skill there is with its source (`shared`, `own`,
 * `github.com/…`), a check on the ones the persona carries; picking one
 * switches it on or off. A switch, a pick and a removal each go to the engine
 * at once and come back as the new listing (one commit each); they are not
 * part of the page's Save. The popup's last row uploads an own skill into
 * the persona's folder (req-237) — the shared pool is filled in Settings →
 * Skills library (req-289). Built once per load, it repaints itself from
 * `PersonaSkillsState`.
 */
import { h } from '../board/desk-deps';
import type { BlockContext } from './persona-block-context';
import { listboxOf } from './persona-controls';
import { blockHead, outlineButton } from './persona-dom';
import { skillAddControl } from './persona-skill-add';
import { skillRowNode } from './persona-skill-row';
import { failureTextOf, librarySkillsOf, personaSkillRowsOf, skillRowsOf, type SkillRow } from './persona-skills-model';
import { uploadPlanOf } from './skill-upload-model';

export interface SkillsBlock {
  readonly element: HTMLElement;
  dispose(): void;
}

/** The library's options: the check on what the persona carries, the source at the right. */
function libraryList(ctx: BlockContext, rows: readonly SkillRow[], pick: (row: SkillRow) => void): HTMLElement {
  const options = rows.map((row) => ({
    value: row.name,
    selected: row.on,
    content: [h('span', 'persona-grow persona-lib-name', row.title), h('span', 'persona-mono persona-muted persona-lib-source', row.source.label)],
  }));
  return listboxOf(ctx.api, ctx.t('persona.skills.library'), options, (name) => {
    const row = rows.find((entry) => entry.name === name);
    if (row !== undefined) {
      pick(row);
    }
  });
}

export function createSkillsBlock(ctx: BlockContext): SkillsBlock {
  const { t, api } = ctx;
  const state = ctx.skills;
  const block = h('section', 'persona-block');
  block.setAttribute('aria-label', t('persona.page.skills'));
  const list = h('div', 'persona-skill-list');
  list.setAttribute('role', 'list');
  const problem = h('div', 'persona-note persona-state-error persona-skill-problem');
  problem.setAttribute('role', 'alert');
  const library = h('div', 'persona-library');
  library.hidden = true;
  const search = h('input', 'persona-input persona-library-search');
  search.type = 'text';
  search.setAttribute('aria-label', t('persona.skills.search'));
  const found = h('div', 'persona-library-list');
  const add = skillAddControl(t, (kind, files) => {
    void uploadPlanOf(kind, files)
      .then((plan) => (plan.ok ? state.upload(plan.command) : state.fail({ ok: false, code: plan.code, error: '' })))
      .catch(() => state.fail({ ok: false, code: 'internal', error: '' }));
  });
  const foot = h('div', 'persona-library-foot');
  foot.append(add.element);
  library.append(search, found, foot);

  const opener = outlineButton(t('persona.skills.add_library'), 'persona-btn persona-btn-28', () => {
    library.hidden = !library.hidden;
    opener.setAttribute('aria-expanded', String(!library.hidden));
    if (!library.hidden) {
      paint();
      search.focus();
    }
  });
  opener.setAttribute('aria-haspopup', 'listbox');
  opener.setAttribute('aria-expanded', 'false');
  library.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      library.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      opener.focus();
    }
  });

  const paint = (): void => {
    const listing = state.list;
    const all = listing === null ? [] : skillRowsOf(listing, ctx.persona.id);
    list.replaceChildren(...personaSkillRowsOf(all).map((row) => skillRowNode(api, t, row, { persona: ctx.draft().title, busy: state.busy, toggle: (name, on) => void state.toggle(name, on) })));
    if (!library.hidden) {
      found.replaceChildren(libraryList(ctx, librarySkillsOf(all, search.value), (row) => void state.toggle(row.name, !row.on)));
    }
    const failure = state.failure;
    problem.textContent = failure === null ? '' : failureTextOf(t, failure);
    problem.hidden = failure === null;
    opener.disabled = state.busy;
    add.setBusy(state.busy);
  };

  search.addEventListener('input', () => paint());
  const off = state.subscribe(paint);
  block.append(blockHead(t('persona.page.skills'), null, opener), library, problem, list);
  paint();
  return { element: block, dispose: off };
}
