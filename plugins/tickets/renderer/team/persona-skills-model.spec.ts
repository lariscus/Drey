import { describe, expect, it } from 'vitest';
import type { SkillListData } from '../../../../packages/tickets-engine/src/contracts/skills';
import { failureKeyOf, failureTextOf, skillCountsOf, skillPathOf, skillRowsOf, skillTitleOf } from './persona-skills-model';
import { skillsOf } from './persona-skills.fixture';

const list = (over: Partial<SkillListData> = {}): SkillListData => ({
  persona: 'ben',
  skills: skillsOf(),
  missing: [],
  selectedTokens: 550,
  tokenizer: { id: 'claude-estimate', family: 'anthropic', exact: false, model: null },
  ...over,
});

describe('the skill rows (R11, req-237)', () => {
  it('words a skill id', () => {
    expect(skillTitleOf('go-conventions')).toBe('Go conventions');
    expect(skillTitleOf('tdd')).toBe('Tdd');
  });

  it('draws one row per listed skill in the engine’s order, off rows included; only an own skill is removable', () => {
    expect(skillRowsOf(list(), 'ben')).toEqual([
      { name: 'tdd', title: 'Tdd', description: 'tdd skill', path: 'personas/ben/skills/tdd/SKILL.md', origin: 'own', tokens: 240, on: true, removable: true },
      { name: 'go-conventions', title: 'Go conventions', description: 'go-conventions skill', path: '_meta/skills/go-conventions/SKILL.md', origin: 'shared', tokens: 310, on: true, removable: false },
      { name: 'diff-review', title: 'Diff review', description: 'diff-review skill', path: '_meta/skills/diff-review/SKILL.md', origin: 'shared', tokens: 400, on: false, removable: false },
    ]);
  });

  it('lists the skills that are on first and keeps the engine’s order within each group', () => {
    const [first, second, third] = skillsOf();
    const mixed = [{ ...first!, name: 'a', on: false }, { ...second!, name: 'b', on: true }, { ...third!, name: 'c', on: false }, { ...first!, name: 'd', on: true }];
    expect(skillRowsOf(list({ skills: mixed }), 'ben').map((row) => row.name)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('adds a row, on, for every name that no folder holds, so it can be switched off', () => {
    expect(skillRowsOf(list({ skills: [], missing: ['ghost'] }), 'ben')).toEqual([{ name: 'ghost', title: 'Ghost', description: '', path: null, origin: null, tokens: null, on: true, removable: false }]);
  });

  it('shows a flat file the migration has not turned into a folder as its file', () => {
    expect(skillPathOf({ name: 'lint', origin: 'shared', legacy: true }, 'ben')).toBe('_meta/skills/lint.md');
    expect(skillPathOf({ name: 'lint', origin: 'own', legacy: true }, 'ben')).toBe('personas/ben/skills/lint.md');
  });

  it('counts what is on, what is available and what the ones on cost a run', () => {
    expect(skillCountsOf(list())).toEqual({ on: 2, total: 3, tokens: 550 });
    expect(skillCountsOf(list({ missing: ['ghost'] }))).toEqual({ on: 3, total: 4, tokens: 550 });
  });

  it('turns a code into its catalog key; a transport failure or an unknown code has none', () => {
    expect(failureKeyOf({ ok: false, code: 'not_own', error: 'x' })).toBe('skills.error.not_own');
    expect(failureKeyOf({ ok: false, code: null, error: 'fetch failed' })).toBeNull();
  });

  it('says what a failure says: the catalog line, else the engine’s text, else the catalog’s internal line', () => {
    const t = (key: string): string => `<${key}>`;
    expect(failureTextOf(t, { ok: false, code: 'exists', error: 'x' })).toBe('<skills.error.exists>');
    expect(failureTextOf(t, { ok: false, code: null, error: 'fetch failed' })).toBe('fetch failed');
    expect(failureTextOf(t, { ok: false, code: null, error: '' })).toBe('<skills.error.internal>');
  });
});

