import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { fetchCommand, fetchedText, groupOf, rowKey, rowSourceText, sourceLabel, tokensText, visibleRows } from './skills-library-model';
import { library } from './skills-library.fixture';

describe('Skills library model', () => {
  it('writes a source as its repository, with the folder when it has one', () => {
    expect(sourceLabel({ repo: 'github.com/acme/skills', path: '' })).toBe('github.com/acme/skills');
    expect(sourceLabel({ repo: 'github.com/acme/skills', path: 'skills/e2e' })).toBe('github.com/acme/skills/skills/e2e');
  });

  it('sorts a row into Shared, GitHub or Own and keys an own skill by its persona', () => {
    expect(library.skills.map(groupOf)).toEqual(['shared', 'github', 'shared', 'shared', 'github', 'own', 'github', 'shared']);
    expect(rowKey({ name: 'notes', persona: 'paul' })).toBe('paul/notes');
    expect(rowKey({ name: 'notes', persona: null })).toBe('notes');
    expect(library.skills.map((row) => rowSourceText(i18n, row))[5]).toBe('own');
  });

  it('searches every word in the name, its title, the description and the source', () => {
    expect(visibleRows(library.skills, 'all', 'Playwright E2E').map((row) => row.name)).toEqual(['playwright-e2e']);
    expect(visibleRows(library.skills, 'github', 'acme').map((row) => row.name)).toEqual(['angular-standalone', 'playwright-e2e']);
    expect(visibleRows(library.skills, 'shared', '   ')).toHaveLength(4);
  });

  it('writes sizes and the last fetch as the board does', () => {
    expect(tokensText(i18n, 1)).toBe('1 token');
    expect(tokensText(i18n, 420)).toBe('420 tokens');
    expect(tokensText(i18n, 1240)).toBe('1.2k tokens');
    expect(tokensText(i18n, 15000)).toBe('15k tokens');
    const now = new Date(2026, 10, 13, 18, 0);
    expect(fetchedText(i18n, new Date(2026, 10, 13, 9, 12).toISOString(), now)).toBe(`Last fetched today ${i18n.formatTime(new Date(2026, 10, 13, 9, 12))}`);
    expect(fetchedText(i18n, new Date(2026, 0, 2).toISOString(), now)).toBe(`Last fetched ${i18n.formatDate(new Date(2026, 0, 2))}`);
    expect(fetchedText(i18n, '', now)).toBe('');
  });

  it('takes the Fetch row only with a repository and a ref', () => {
    expect(fetchCommand(' acme/skills ', '', 'main')).toEqual({ repo: 'acme/skills', path: '', ref: 'main' });
    expect(fetchCommand('', 'x', 'main')).toBeNull();
    expect(fetchCommand('acme/skills', '', ' ')).toBeNull();
  });
});
