import { describe, expect, it } from 'vitest';
import { estimateTokens, tokenizerFor } from '../core/token-count';
import { skillsSection } from '../fleet/skills-section';
import { MemorySkillFileSystem } from './skill-file-system.fake';
import { SkillFolderReader } from './skill-folder-reader';
import { SkillLister } from './skill-lister';

const SHARED = 'tickets/_meta/skills';
const OWN = 'tickets/_meta/personas/p/skills';

const files = {
  [`${SHARED}/review/SKILL.md`]: '---\nname: review\ndescription: Shared review\nlicense: MIT\nallowed-tools: Read Grep\n---\n\nShared body.\n',
  [`${SHARED}/review/scripts/run.sh`]: '#!/bin/sh',
  [`${SHARED}/review/references/a.md`]: 'ref',
  [`${SHARED}/git/SKILL.md`]: '---\nname: git-tips\ndescription: Git\n---\nCommit small.',
  [`${SHARED}/flat.md`]: '# Flat skill\n\ntext',
  [`${OWN}/review/SKILL.md`]: '---\nname: review\ndescription: Own review\n---\nOwn body.',
};

function lister(): SkillLister {
  const fs = new MemorySkillFileSystem(files);
  return new SkillLister(new SkillFolderReader(fs), fs);
}

const claude = tokenizerFor('claude-code', 'opus');

describe('SkillLister', () => {
  it('lists the effective skills of a persona with the switch from its skills: list', async () => {
    const { skills, missing } = await lister().list('p', ['review', 'ghost'], claude);
    expect(skills.map((s) => [s.name, s.origin, s.on, s.overridesShared, s.legacy])).toEqual([
      ['flat', 'shared', false, false, true],
      ['git', 'shared', false, false, false],
      ['review', 'own', true, true, false],
    ]);
    expect(missing).toEqual(['ghost']);
  });

  it('describes each skill: description, size, files beside SKILL.md, tools, licence, a differing frontmatter name', async () => {
    const [flat, git] = (await lister().list('q', [], claude)).skills;
    expect(flat).toMatchObject({ description: 'Flat skill', files: 0, legacy: true });
    expect(git).toMatchObject({ description: 'Git', declaredName: 'git-tips', files: 0 });
    const shared = (await lister().list('q', [], claude)).skills.find((s) => s.name === 'review')!;
    expect(shared).toMatchObject({ origin: 'shared', files: 2, license: 'MIT', allowedTools: ['Read', 'Grep'], declaredName: null });
    expect(shared.size).toBe(new TextEncoder().encode(files[`${SHARED}/review/SKILL.md`]).byteLength);
  });

  it('counts the tokens a run would load of each skill (heading and body), and of the selection as the one block', async () => {
    const list = await lister().list('p', ['review', 'git'], claude);
    expect(list.skills.find((s) => s.name === 'review')!.tokens).toBe(estimateTokens('### review\n\nOwn body.', claude));
    const block = skillsSection([
      { name: 'review', text: 'Own body.' },
      { name: 'git', text: 'Commit small.' },
    ]);
    expect(list.selectedTokens).toBe(estimateTokens(block!, claude));
    expect(list.tokenizer).toBe(claude);
  });

  it('the shared pool lists with nothing on, and an empty selection costs nothing', async () => {
    const pool = await lister().list(null, [], tokenizerFor('opencode', 'qwen'));
    expect(pool.persona).toBeNull();
    expect(pool.skills.every((s) => !s.on && s.origin === 'shared')).toBe(true);
    expect(pool.selectedTokens).toBe(0);
    expect(pool.tokenizer.family).toBe('openai-compatible');
  });
});
