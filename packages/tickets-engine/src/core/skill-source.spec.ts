import { describe, expect, it } from 'vitest';
import { isRefName, isVersionRef, MAX_SOURCE_SKILLS, newerVersionRef, normalizeSourcePath, parseGithubRepo, skillsInTree, sourceIdOf, type TreeEntry } from './skill-source';

const blob = (path: string, size = 10): TreeEntry => ({ path, type: 'blob', size });

describe('parseGithubRepo', () => {
  it('reads the spellings an owner pastes into one github.com/<owner>/<repo>', () => {
    for (const input of ['github.com/acme/skills', 'https://github.com/acme/skills', 'https://github.com/acme/skills.git', 'http://www.github.com/acme/skills/', 'git@github.com:acme/skills.git', 'acme/skills', '  acme/skills  ']) {
      expect(parseGithubRepo(input)).toEqual({ owner: 'acme', name: 'skills', repo: 'github.com/acme/skills' });
    }
  });

  it('refuses another host, a deeper path, an empty part and a dot repository', () => {
    for (const input of ['', 'acme', 'gitlab.com/acme/skills', 'github.com/acme/skills/tree/main', 'acme/', '/skills', 'acme/..', '-acme/skills', 'a c/skills']) {
      expect(parseGithubRepo(input)).toBeNull();
    }
  });
});

describe('normalizeSourcePath, isRefName, sourceIdOf', () => {
  it('keeps a folder inside the repository and refuses one that leaves it', () => {
    expect(normalizeSourcePath(undefined)).toBe('');
    expect(normalizeSourcePath(' /skills/e2e/ ')).toBe('skills/e2e');
    expect(normalizeSourcePath('skills\\e2e')).toBe('skills/e2e');
    expect(normalizeSourcePath('skills/../x')).toBeNull();
    expect(normalizeSourcePath('skills//e2e')).toBeNull();
  });

  it('takes tag and branch names and refuses what is no ref', () => {
    expect(['main', 'v1.4', 'release/2026-11', 'feature_x.y'].every(isRefName)).toBe(true);
    expect(['', '-x', 'a..b', 'a/', 'x.lock', 'a b', '../main'].some(isRefName)).toBe(false);
  });

  it('names a source by its repository and folder', () => {
    expect(sourceIdOf('github.com/acme/skills', '')).toBe('github.com/acme/skills');
    expect(sourceIdOf('github.com/acme/skills', 'skills/e2e')).toBe('github.com/acme/skills/skills/e2e');
  });
});

describe('skillsInTree', () => {
  it('finds every skill folder under the path with its files, the topmost where folders nest', () => {
    const tree = [blob('README.md'), blob('skills/review/SKILL.md', 40), blob('skills/review/scripts/run.sh', 5), blob('skills/review/examples/a/SKILL.md'), blob('skills/go/SKILL.md'), blob('other/x/SKILL.md'), { path: 'skills', type: 'tree' as const }];
    const found = skillsInTree(tree, 'skills', 'repo');
    expect(found.skills.map((s) => [s.folder, s.name])).toEqual([
      ['skills/go', 'go'],
      ['skills/review', 'review'],
    ]);
    expect(found.skills[1]!.files).toEqual([
      { path: 'SKILL.md', size: 40 },
      { path: 'scripts/run.sh', size: 5 },
      { path: 'examples/a/SKILL.md', size: 10 },
    ]);
    expect(found.skipped).toEqual([]);
  });

  it('takes the path itself as the skill when it holds the SKILL.md, and the repository name for a skill at the root', () => {
    expect(skillsInTree([blob('skills/e2e/SKILL.md'), blob('skills/e2e/ref.md')], 'skills/e2e', 'repo').skills.map((s) => s.name)).toEqual(['e2e']);
    expect(skillsInTree([blob('SKILL.md')], '', 'playwright-skill').skills.map((s) => [s.folder, s.name])).toEqual([['', 'playwright-skill']]);
  });

  it('skips a folder whose name is no skill name and the ones beyond the bound', () => {
    const many = Array.from({ length: MAX_SOURCE_SKILLS + 1 }, (_, i) => blob(`s/k${String(i).padStart(3, '0')}/SKILL.md`));
    const found = skillsInTree([...many, blob('s/.hidden/SKILL.md')], 's', 'r');
    expect(found.skills).toHaveLength(MAX_SOURCE_SKILLS);
    expect(found.skipped).toEqual([
      { folder: 's/.hidden', reason: 'bad_name' },
      { folder: `s/k${String(MAX_SOURCE_SKILLS).padStart(3, '0')}`, reason: 'too_many' },
    ]);
  });
});

describe('newerVersionRef', () => {
  it('finds the highest tag above the current one, written the same way', () => {
    expect(newerVersionRef('v1.4', ['v1.3', 'v1.5', 'v1.10', '2.0', 'latest'])).toBe('v1.10');
    expect(newerVersionRef('1.4.0', ['1.4.1', 'v9'])).toBe('1.4.1');
    expect(newerVersionRef('v1.4', ['v1.4', 'v1.4.0', 'v1.2'])).toBeNull();
    expect(newerVersionRef('main', ['v2'])).toBeNull();
  });

  it('tells a version tag from a branch', () => {
    expect(isVersionRef('v1.4')).toBe(true);
    expect(isVersionRef('2.0.1')).toBe(true);
    expect(isVersionRef('main')).toBe(false);
  });
});
