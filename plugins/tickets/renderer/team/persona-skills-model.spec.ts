import { describe, expect, it, vi } from 'vitest';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { writeVaultsText, writeVaultsToggled } from './persona-allowed-model';
import { estimateTokens, vaultSkillsSeam } from './persona-seams';
import { skillLinesOf, skillsToggled, skillTitleOf } from './persona-skills-model';

describe('the skill rows (R11)', () => {
  it('words a skill id', () => {
    expect(skillTitleOf('go-conventions')).toBe('Go conventions');
    expect(skillTitleOf('tdd')).toBe('Tdd');
  });

  it('keeps the rows of the loaded skills and adds the ones switched on since; a row switched off stays', () => {
    const infos = [{ name: 'tdd', path: 'skills/tdd/SKILL.md', origin: 'own' as const, tokens: 240 }];
    expect(skillLinesOf(['tdd', 'diff-review'], ['tdd', 'new-one'], infos)).toEqual([
      { name: 'tdd', title: 'Tdd', path: 'skills/tdd/SKILL.md', origin: 'own', tokens: 240, on: true },
      { name: 'diff-review', title: 'Diff review', path: null, origin: null, tokens: null, on: false },
      { name: 'new-one', title: 'New one', path: null, origin: null, tokens: null, on: true },
    ]);
  });

  it('switches by adding last or removing; no duplicates', () => {
    expect(skillsToggled(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(skillsToggled(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(skillsToggled(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});

describe('the write-vaults choice', () => {
  const vaults = [
    { id: 'v1', name: 'tickets' },
    { id: 'notes', name: 'notes' },
  ];

  it('names the vaults, an unknown id as it is, and none as the given word', () => {
    expect(writeVaultsText([], vaults, 'None')).toBe('None');
    expect(writeVaultsText(['notes', 'gone'], vaults, 'None')).toBe('notes, gone');
  });

  it('ticks and unticks in the registry order, unknown ids last', () => {
    expect(writeVaultsToggled(['gone'], vaults, 'notes', true)).toEqual(['notes', 'gone']);
    expect(writeVaultsToggled(['notes', 'v1'], vaults, 'notes', false)).toEqual(['v1']);
  });
});

describe('the skills seam (D-46 reading) and the token stand-in', () => {
  it('estimates about four characters to a token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(41))).toBe(11);
  });

  it('finds a skill in the persona folder first, then the shared one; a name no folder holds is left out', async () => {
    const files: Record<string, string> = {
      'tickets/_meta/personas/ben/skills/tdd/SKILL.md': 'x'.repeat(40),
      'tickets/_meta/skills/review.md': 'y'.repeat(80),
      'tickets/_meta/skills/tdd.md': 'shadowed',
    };
    const readFile = vi.fn(async (path: string) => {
      if (files[path] === undefined) {
        throw new Error('ENOENT');
      }
      return { content: files[path]!, modifiedMs: 1 };
    });
    const api = { vault: { readFile } } as unknown as DreyPluginApi;
    expect(await vaultSkillsSeam(api, 'v1').list('ben', ['tdd', 'review', 'ghost', '../escape'])).toEqual([
      { name: 'tdd', path: 'personas/ben/skills/tdd/SKILL.md', origin: 'own', tokens: 10 },
      { name: 'review', path: 'skills/review.md', origin: 'shared', tokens: 20 },
    ]);
    expect(await vaultSkillsSeam(api, null).list('ben', ['tdd'])).toEqual([]);
  });
});
