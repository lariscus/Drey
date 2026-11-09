import { describe, expect, it } from 'vitest';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillFolderReader } from './skill-folder-reader';

const skill = (name: string, description: string, body: string): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

const SHARED = 'tickets/_meta/skills';
const OWN = 'tickets/_meta/personas/p/skills';

function reader(files: Record<string, string>): SkillFolderReader {
  return new SkillFolderReader(new MemorySkillFileSystem(files));
}

describe('SkillFolderReader.home', () => {
  it('reads folder skills and legacy flat files, sorted by name, ignoring what is neither', async () => {
    const found = await reader({
      [`${SHARED}/zeta/SKILL.md`]: skill('zeta', 'z', 'Z body'),
      [`${SHARED}/zeta/scripts/run.sh`]: '#!/bin/sh',
      [`${SHARED}/alpha.md`]: 'Flat alpha.',
      [`${SHARED}/notes.txt`]: 'not a skill',
      [`${SHARED}/empty-folder/readme.md`]: 'a folder without SKILL.md is no skill',
      [`${SHARED}/bad name.md`]: 'not a skill name',
    }).home(SHARED, 'shared');
    expect(found.map((r) => [r.name, r.legacy, r.origin])).toEqual([
      ['alpha', true, 'shared'],
      ['zeta', false, 'shared'],
    ]);
    expect(found[1]!.parsed.description).toBe('z');
    expect(found[1]!.file).toBe(`${SHARED}/zeta/SKILL.md`);
    expect(found[0]!.file).toBe(`${SHARED}/alpha.md`);
  });

  it('a folder beats a flat file of its name (both present)', async () => {
    const found = await reader({
      [`${SHARED}/both/SKILL.md`]: skill('both', 'folder', 'The folder.'),
      [`${SHARED}/both.md`]: 'The flat file.',
    }).home(SHARED, 'shared');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ legacy: false, parsed: { body: 'The folder.' } });
  });

  it('an absent home is an empty list', async () => {
    expect(await reader({}).home(SHARED, 'shared')).toEqual([]);
  });
});

describe('SkillFolderReader.available — own over shared (D-46)', () => {
  const files = {
    [`${SHARED}/review/SKILL.md`]: skill('review', 'shared review', 'Shared.'),
    [`${SHARED}/git/SKILL.md`]: skill('git', 'git', 'Git.'),
    [`${OWN}/review/SKILL.md`]: skill('review', 'own review', 'Own.'),
    [`${OWN}/mine.md`]: 'Own flat.',
  };

  it('one record per name; an own skill hides the shared one and is reported as overriding', async () => {
    const { records, overriding } = await reader(files).available('p');
    expect(records.map((r) => [r.name, r.origin, r.parsed.body])).toEqual([
      ['git', 'shared', 'Git.'],
      ['mine', 'own', 'Own flat.'],
      ['review', 'own', 'Own.'],
    ]);
    expect([...overriding]).toEqual(['review']);
  });

  it('another persona sees the shared one; no persona reads the pool alone', async () => {
    expect((await reader(files).available('q')).records.find((r) => r.name === 'review')?.origin).toBe('shared');
    const pool = await reader(files).available(null);
    expect(pool.records.map((r) => r.name)).toEqual(['git', 'review']);
    expect(pool.overriding.size).toBe(0);
  });
});
