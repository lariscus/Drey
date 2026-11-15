import { describe, expect, it, vi } from 'vitest';
import { parseSkillMarkdown } from '../core/skills/skill';
import type { EngineVault } from './host';
import { SkillCommitter } from './skill-committer';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillMigrator } from './skill-migrator';

const VAULT: EngineVault = { id: 'v', name: 'tickets', path: '/vault', exists: true, active: true };
const SHARED = 'tickets/_meta/skills';
const OWN = 'tickets/_meta/personas/ben/skills';

function setup(files: Record<string, string>): {
  fs: MemorySkillFileSystem;
  migrator: SkillMigrator;
  commit: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
} {
  const fs = new MemorySkillFileSystem(files);
  const commit = vi.fn(async () => undefined);
  const log = vi.fn();
  const committer = new SkillCommitter({ announceChanges: vi.fn(), log }, { locate: async () => ({ root: '/vault', prefix: '' }), commitTree: commit });
  return { fs, migrator: new SkillMigrator(fs, committer, { log }), commit, log };
}

describe('SkillMigrator', () => {
  it('turns a flat file into a folder with a generated frontmatter, one commit for every home', async () => {
    const { fs, migrator, commit } = setup({
      [`${SHARED}/review.md`]: '# Review checklist\n\n- one\n',
      [`${OWN}/tdd.md`]: 'Write the test first.',
    });
    const result = await migrator.run(VAULT, ['ben']);
    expect(result).toEqual({ migrated: ['shared/review', 'ben/tdd'], shadowed: [] });
    expect([...fs.store.keys()].sort()).toEqual([`${OWN}/tdd/SKILL.md`, `${SHARED}/review/SKILL.md`]);
    const migrated = parseSkillMarkdown((await fs.readText(`${SHARED}/review/SKILL.md`))!);
    expect(migrated).toMatchObject({ name: 'review', description: 'Review checklist', body: '# Review checklist\n\n- one' });
    expect(commit).toHaveBeenCalledOnce();
    const [, paths, message] = commit.mock.calls[0]!;
    expect(message).toBe('skills: migrate flat skill files to Agent Skills folders');
    expect([...paths].sort()).toEqual([`${OWN}/tdd.md`, `${OWN}/tdd/SKILL.md`, `${SHARED}/review.md`, `${SHARED}/review/SKILL.md`]);
  });

  it('leaves a folder-only home untouched and commits nothing', async () => {
    const { fs, migrator, commit } = setup({ [`${SHARED}/ok/SKILL.md`]: '---\nname: ok\ndescription: d\n---\nBody' });
    expect(await migrator.run(VAULT, ['ben'])).toEqual({ migrated: [], shadowed: [] });
    expect([...fs.store.keys()]).toEqual([`${SHARED}/ok/SKILL.md`]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a folder and a flat file of one name: the folder wins and the flat file is dropped', async () => {
    const { fs, migrator } = setup({
      [`${SHARED}/both/SKILL.md`]: '---\nname: both\ndescription: d\n---\nThe folder.',
      [`${SHARED}/both.md`]: 'The flat file.',
    });
    expect(await migrator.run(VAULT, [])).toEqual({ migrated: [], shadowed: ['shared/both'] });
    expect([...fs.store.keys()]).toEqual([`${SHARED}/both/SKILL.md`]);
    expect(await fs.readText(`${SHARED}/both/SKILL.md`)).toContain('The folder.');
  });

  it('runs once: a second pass finds nothing flat and changes nothing', async () => {
    const { migrator, commit } = setup({ [`${SHARED}/review.md`]: 'Text.' });
    await migrator.run(VAULT, []);
    expect(await migrator.run(VAULT, [])).toEqual({ migrated: [], shadowed: [] });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('keeps what is no skill: a blank flat file, a README, a name that is not a folder name', async () => {
    const { fs, migrator } = setup({ [`${SHARED}/blank.md`]: '  \n', [`${SHARED}/README.md`]: 'About this folder', [`${SHARED}/bad name.md`]: 'x' });
    expect(await migrator.run(VAULT, [])).toEqual({ migrated: [], shadowed: [] });
    expect(fs.store.size).toBe(3);
  });

  it('keeps an existing frontmatter and logs the migration', async () => {
    const { fs, migrator, log } = setup({ [`${SHARED}/lic.md`]: '---\nlicense: MIT\n---\nUse tabs.' });
    await migrator.run(VAULT, []);
    expect(parseSkillMarkdown((await fs.readText(`${SHARED}/lic/SKILL.md`))!)).toMatchObject({ name: 'lic', license: 'MIT', description: 'Use tabs.' });
    expect(log).toHaveBeenCalledWith('skills: migrated shared/lic', 'info');
  });
});
