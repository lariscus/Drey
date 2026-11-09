import { describe, expect, it } from 'vitest';
import { loadPersonaSkills } from './persona';

/** What a run loads of a persona's selection: nearest first, folder before flat file, the body only (D-46, R8). */
describe('loadPersonaSkills', () => {
  const files: Readonly<Record<string, string>> = {
    'tickets/_meta/personas/p/skills/own/SKILL.md': '---\nname: own\ndescription: own one\n---\n\nOwn folder skill.\n',
    'tickets/_meta/skills/own/SKILL.md': '---\nname: own\ndescription: shared\n---\nThe shared one loses.',
    'tickets/_meta/personas/p/skills/legacy.md': 'Own legacy skill.',
    'tickets/_meta/skills/legacy/SKILL.md': '---\nname: legacy\ndescription: shared\n---\nShared folder.',
    'tickets/_meta/skills/shared/SKILL.md': '---\nname: shared\ndescription: d\n---\nShared skill.',
    'tickets/_meta/skills/flat.md': 'Shared flat skill.',
    'tickets/_meta/skills/both/SKILL.md': '---\nname: both\ndescription: d\n---\nThe folder.',
    'tickets/_meta/skills/both.md': 'The flat file loses.',
    'tickets/_meta/skills/blank.md': '   ',
    'tickets/_meta/skills/renamed/SKILL.md': '---\nname: other-name\ndescription: d\n---\nFolder wins.',
    'tickets/_meta/skills/headless/SKILL.md': '---\nname: headless\ndescription: d\n---\n',
  };
  const read = async (rel: string): Promise<string | null> => files[rel] ?? null;

  it('finds them nearest first, in the order the record names them, with the frontmatter stripped', async () => {
    const found = await loadPersonaSkills(read, 'p', ['shared', 'own', 'legacy', 'flat']);
    expect(found.skills).toEqual([
      { name: 'shared', text: 'Shared skill.' },
      { name: 'own', text: 'Own folder skill.' },
      { name: 'legacy', text: 'Own legacy skill.' },
      { name: 'flat', text: 'Shared flat skill.' },
    ]);
    expect(found.missing).toEqual([]);
  });

  it('a folder beats a flat file of its name', async () => {
    expect((await loadPersonaSkills(read, 'p', ['both'])).skills).toEqual([{ name: 'both', text: 'The folder.' }]);
  });

  it('a name with no file, no body or a path in it is reported missing and never read', async () => {
    const asked: string[] = [];
    const found = await loadPersonaSkills(
      async (rel) => {
        asked.push(rel);
        return read(rel);
      },
      'p',
      ['nope', 'blank', 'headless', '../../secret', ''],
    );
    expect(found.skills).toEqual([]);
    expect(found.missing).toEqual(['nope', 'blank', 'headless', '../../secret', '']);
    expect(asked.some((rel) => rel.includes('secret'))).toBe(false);
  });

  it('warns when the frontmatter calls a skill by another name; the folder name wins', async () => {
    const found = await loadPersonaSkills(read, 'p', ['renamed']);
    expect(found.skills).toEqual([{ name: 'renamed', text: 'Folder wins.' }]);
    expect(found.warnings).toEqual(['skill renamed: the frontmatter calls it "other-name" - the folder name wins']);
  });

  it('a read that throws counts as absent', async () => {
    const found = await loadPersonaSkills(async () => Promise.reject(new Error('disk')), 'p', ['own']);
    expect(found.missing).toEqual(['own']);
  });
});
