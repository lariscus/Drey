import { describe, expect, it } from 'vitest';
import { composeRunRequest } from '../fleet/request';
import { base, REPO } from '../fleet/request-spec-support';
import { parseRepos, reposFileText, reposProse } from './repos-file';

const file = (entry: string): string => ['---', 'repos:', '  drey:', '    url: https://example.test/drey.git', entry, '---', 'Notes.', ''].join('\n');

describe('repos.md — the retired profile key (req-290)', () => {
  it('reads an old `profile` of any value and silently ignores it', () => {
    for (const profile of ['work', 'private', 'office']) {
      const parsed = parseRepos(file(`    profile: ${profile}`));
      expect(parsed.error).toBeNull();
      expect(parsed.repos[0]).toMatchObject({ name: 'drey' });
      expect('profile' in parsed.repos[0]!).toBe(false);
    }
  });

  it('drops the key on write: a round trip through the file never emits it again', () => {
    const withOld = file('    profile: work');
    const text = reposFileText(parseRepos(withOld).repos, reposProse(withOld));
    expect(text).not.toContain('profile');
    expect(parseRepos(text).repos[0]).toMatchObject({ name: 'drey' });
  });

  it('a run request never carries a profile, whatever the file said', () => {
    const work = composeRunRequest(base({ repo: REPO }));
    expect(work.ok && 'profile' in work.request).toBe(false);
  });
});

describe('repos.md — the split kept every older rule', () => {
  it('reads every key as before, link and instructions included', () => {
    const text = file(['    branch: main', '    path: W:\\drey', '    worker: opencode', '    launch: npm start', '    instructions: AGENTS.md', '    link: [.tools, node_modules/]'].join('\n'));
    expect(parseRepos(text)).toEqual({
      repos: [{ name: 'drey', url: 'https://example.test/drey.git', branch: 'main', policy: null, path: 'W:\\drey', worker: 'opencode', worktrees: null, launch: 'npm start', instructions: 'AGENTS.md', link: ['.tools', 'node_modules'] }],
      error: null,
      warnings: [],
    });
  });

  it('tolerates a bad launch or instructions with a warning, refuses a bad link or a missing url', () => {
    expect(parseRepos(file('    launch: 3')).warnings).toEqual(['repos.md: repo "drey" launch must be a command string']);
    expect(parseRepos(file('    instructions: ../x.md')).warnings).toEqual(['repos.md: repo "drey" instructions must be a file path inside the repo']);
    expect(parseRepos(file('    link: ../up')).error).toBe('repos.md: repo "drey" link: "../up" must be a path inside the repo (no absolute path, no ..)');
    expect(parseRepos(['---', 'repos:', '  drey: {}', '---', ''].join('\n')).error).toBe('repos.md: repo "drey" needs a url');
    expect(parseRepos('no fence').error).toBe('repos.md has no frontmatter fence');
    expect(parseRepos(null)).toEqual({ repos: [], error: null, warnings: [] });
  });
});
