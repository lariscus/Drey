import { describe, expect, it } from 'vitest';
import { composeRunRequest } from '../fleet/request';
import { base, REPO } from '../fleet/request-spec-support';
import { parseRepos, reposFileText, reposProse } from './repos-file';

const file = (entry: string): string => ['---', 'repos:', '  drey:', '    url: https://example.test/drey.git', entry, '---', 'Notes.', ''].join('\n');

describe('repos.md — the profile key (req-177)', () => {
  it('reads `profile: work` and `profile: private`; absent stays absent (reads as private)', () => {
    expect(parseRepos(file('    profile: work')).repos[0]?.profile).toBe('work');
    expect(parseRepos(file('    profile: private')).repos[0]?.profile).toBe('private');
    const plain = parseRepos(file('    branch: main')).repos[0];
    expect(plain).toBeDefined();
    expect('profile' in plain!).toBe(false);
  });

  it('refuses any other profile: a repository is never run under a guessed one', () => {
    expect(parseRepos(file('    profile: office'))).toEqual({ repos: [], error: 'repos.md: repo "drey" profile must be private or work', warnings: [] });
  });

  it('writes the profile back, and a file without one stays without', () => {
    const parsed = parseRepos(file('    profile: work')).repos;
    const text = reposFileText(parsed, reposProse(file('    profile: work')));
    expect(text).toContain('profile: work');
    expect(parseRepos(text).repos[0]?.profile).toBe('work');
    expect(reposFileText(parseRepos(file('    branch: main')).repos, 'Notes.')).not.toContain('profile');
  });

  it("the run request carries the repository's profile, and none without one", () => {
    const work = composeRunRequest(base({ repo: { ...REPO, profile: 'work' } }));
    expect(work.ok && work.request.profile).toBe('work');
    const plain = composeRunRequest(base());
    expect(plain.ok && 'profile' in plain.request).toBe(false);
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
