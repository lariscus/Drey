// i18n: catalog
/**
 * Settings → Skills library, Skills (board 7o): the search and the All |
 * Shared | GitHub | Own filter, a header row, and one row per skill — its
 * title, where it comes from, the personas that use it, its size in tokens
 * and a `⋯` menu with Delete, which asks in the row first (naming how many
 * personas use it: req-245's confirmed deletion of a shared skill).
 */
import type { SkillLibraryRow } from '../../../../packages/tickets-engine/src/contracts/skill-library';
import { el } from './dom.ts/settings-dom';
import { skillTitleOf } from '../team/persona-skills-model';
import { groupHead } from './models-dom';
import { confirmRow, menuOf, skillGlyph, skillIconButton, userCircle } from './skills-library-dom';
import { LIBRARY_FILTERS, rowKey, rowSourceText, tokensText, visibleRows, type LibraryFilter } from './skills-library-model';
import type { SkillsLibraryState } from './skills-library-state';

export interface SkillsPart {
  readonly element: HTMLElement;
  paint(): void;
}

const FILTER_KEY = {
  all: 'tickets.settings.skills.filter.all',
  shared: 'tickets.settings.skills.filter.shared',
  github: 'tickets.settings.skills.filter.github',
  own: 'tickets.settings.skills.filter.own',
} as const satisfies Record<LibraryFilter, string>;

export function createSkillsPart(state: SkillsLibraryState): SkillsPart {
  const { t, api } = state;
  const search = el('div', 'skl-search');
  const query = el('input', 'skl-search-input');
  query.type = 'search';
  query.spellcheck = false;
  query.setAttribute('aria-label', t('tickets.settings.skills.search'));
  query.addEventListener('input', () => {
    state.query = query.value;
    paintRows();
  });
  search.append(skillGlyph('search', 14), query);
  const seg = el('div', 'skl-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', t('tickets.settings.skills.filter.label'));
  const filterButtons = LIBRARY_FILTERS.map((filter) => {
    const button = el('button', undefined, t(FILTER_KEY[filter]));
    button.type = 'button';
    button.addEventListener('click', () => {
      state.filter = filter;
      paint();
    });
    seg.append(button);
    return { filter, button };
  });
  const head = el('div', 'mdl-row skl-th');
  head.append(el('span', 'skl-col-name', t('tickets.settings.skills.col.skill')), el('span', 'skl-col-source', t('tickets.settings.skills.col.source')), el('span', 'skl-col-users', t('tickets.settings.skills.col.used_by')), el('span', 'skl-col-size', t('tickets.settings.skills.col.size')), el('span', 'skl-col-menu'));
  const rows = el('div', 'skl-list');
  const element = el('div', 'skl-skills');
  element.append(groupHead(t('tickets.settings.skills.skills'), search, seg), head, rows);

  function skillRow(row: SkillLibraryRow): HTMLElement {
    const key = rowKey(row);
    const title = skillTitleOf(row.name);
    if (state.confirming === `skill:${key}`) {
      return confirmRow({
        question: t('tickets.settings.skills.delete_ask', { name: title, count: row.usedBy.length }),
        keep: t('tickets.settings.skills.keep'),
        go: t('tickets.settings.skills.delete'),
        busy: state.busy,
        onKeep: () => {
          state.confirming = null;
          state.changed();
        },
        onGo: () => void state.deleteSkill(row.name, row.persona),
      });
    }
    const node = el('div', 'mdl-row skl-skill');
    node.dataset['skill'] = key;
    const name = el('span', 'skl-col-name skl-skill-name', title);
    name.title = row.description;
    const source = el('span', 'skl-col-source skl-mono mdl-sec skl-skill-source', rowSourceText(api.i18n, row));
    source.title = row.persona === null ? source.textContent ?? '' : t('tickets.settings.skills.own_of', { persona: row.persona });
    const users = el('span', 'skl-col-users skl-users');
    users.append(...(row.usedBy.length === 0 ? [el('span', 'mdl-sec skl-nobody', '—')] : row.usedBy.map((user) => userCircle(user.id, user.title, user.color))));
    const opener = skillIconButton('more', 16, t('tickets.settings.skills.actions', { name: title }));
    opener.disabled = state.busy;
    const menu = menuOf(opener, [
      {
        label: t('tickets.settings.skills.delete_menu'),
        run: () => {
          state.confirming = `skill:${key}`;
          state.changed();
        },
      },
    ]);
    node.append(name, source, users, el('span', 'skl-col-size mdl-sec', tokensText(api.i18n, row.tokens)), menu);
    return node;
  }

  function paintRows(): void {
    const all = state.library?.skills ?? [];
    const shown = visibleRows(all, state.filter, state.query);
    rows.replaceChildren(...(shown.length === 0 ? [el('div', 'mdl-row mdl-sec skl-empty', t(all.length === 0 ? 'tickets.settings.skills.no_skills' : 'tickets.settings.skills.no_match'))] : shown.map(skillRow)));
  }

  function paint(): void {
    for (const { filter, button } of filterButtons) {
      button.setAttribute('aria-pressed', String(state.filter === filter));
    }
    if (query.value !== state.query) {
      query.value = state.query;
    }
    paintRows();
  }

  return { element, paint };
}
