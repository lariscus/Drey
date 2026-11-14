// i18n: catalog
/**
 * Settings → Skills library (board 7o, req-289), the pure half: which rows
 * the search and the All | Shared | GitHub | Own filter keep, how a row's
 * source, size and a source's last fetch read. DOM-free.
 */
import type { I18n } from '../../../../shared/i18n/types';
import type { SkillLibraryRow, SkillSourceView } from '../../../../packages/tickets-engine/src/contracts/skill-library';
import type { SkillSourceRef } from '../../../../packages/tickets-engine/src/contracts/skills';
import { skillTitleOf } from '../team/persona-skills-model';

export type LibraryFilter = 'all' | 'shared' | 'github' | 'own';

export const LIBRARY_FILTERS: readonly LibraryFilter[] = ['all', 'shared', 'github', 'own'];

/** A source as the page writes it: the repository, and the folder when there is one. */
export function sourceLabel(source: Pick<SkillSourceRef, 'repo' | 'path'>): string {
  return source.path === '' ? source.repo : `${source.repo}/${source.path}`;
}

/** Which of the filter's groups a row is in. */
export function groupOf(row: Pick<SkillLibraryRow, 'origin' | 'source'>): Exclude<LibraryFilter, 'all'> {
  return row.origin === 'own' ? 'own' : row.source === null ? 'shared' : 'github';
}

/** The rows the filter and the search keep: the search looks at the name, its title, the description and the source. */
export function visibleRows(rows: readonly SkillLibraryRow[], filter: LibraryFilter, query: string): readonly SkillLibraryRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== '');
  return rows.filter((row) => {
    if (filter !== 'all' && groupOf(row) !== filter) {
      return false;
    }
    const hay = [row.name, skillTitleOf(row.name), row.description, row.source === null ? '' : sourceLabel(row.source)].join(' ').toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** A row's identity: an own skill is its persona's, so two personas may hold one name. */
export function rowKey(row: Pick<SkillLibraryRow, 'name' | 'persona'>): string {
  return row.persona === null ? row.name : `${row.persona}/${row.name}`;
}

/** `shared`, `own` or the source, as the Source column reads. */
export function rowSourceText(i18n: I18n, row: Pick<SkillLibraryRow, 'origin' | 'source'>): string {
  const group = groupOf(row);
  return group === 'github' && row.source !== null ? sourceLabel(row.source) : i18n.t(group === 'own' ? 'tickets.settings.skills.origin.own' : 'tickets.settings.skills.origin.shared');
}

/** `420 tokens`, `1.2k tokens` (the board's spelling). */
export function tokensText(i18n: I18n, tokens: number): string {
  if (tokens < 1000) {
    return i18n.t('tickets.settings.skills.tokens', { count: tokens });
  }
  return i18n.t('tickets.settings.skills.tokens_k', { count: i18n.formatNumber(tokens / 1000, { maximumFractionDigits: 1 }) });
}

/** `Last fetched today 09:12`, or the date for an older fetch; '' when the record has no time. */
export function fetchedText(i18n: I18n, iso: string, now: Date): string {
  const at = new Date(iso);
  if (iso === '' || Number.isNaN(at.getTime())) {
    return '';
  }
  const today = at.toDateString() === now.toDateString();
  return today ? i18n.t('tickets.settings.skills.fetched_today', { time: i18n.formatTime(at) }) : i18n.t('tickets.settings.skills.fetched_on', { date: i18n.formatDate(at) });
}

/** The source row's own words: its ref chip and its count. */
export function sourceWords(i18n: I18n, source: SkillSourceView): { readonly ref: string; readonly count: string } {
  return { ref: i18n.t('tickets.settings.skills.ref', { ref: source.ref }), count: i18n.t('tickets.settings.skills.count', { count: source.skills.length }) };
}

/** The Fetch row's fields as the engine takes them; null while the repository or the ref is empty. */
export function fetchCommand(repo: string, path: string, ref: string): { readonly repo: string; readonly path: string; readonly ref: string } | null {
  return repo.trim() === '' || ref.trim() === '' ? null : { repo: repo.trim(), path: path.trim(), ref: ref.trim() };
}
