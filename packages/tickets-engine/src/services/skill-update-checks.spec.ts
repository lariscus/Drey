import { describe, expect, it } from 'vitest';
import type { SkillSourceRecord } from '../core/skills/skill-sources-file';
import { GithubError } from './github-client';
import { FakeGithub } from './github-client.fake';
import { acmeRepo, C14, C15, MAIN } from './skill-library.fixture';
import { SkillUpdateChecks } from './skill-update-checks';

const record = (ref: string, commit: string): SkillSourceRecord => ({ repo: 'github.com/acme/skills', path: '', ref, commit, fetched: '', skills: [] });

function world(start = '2026-11-13T09:00:00Z') {
  const github = new FakeGithub();
  github.set('acme/skills', acmeRepo());
  let now = new Date(start);
  const checks = new SkillUpdateChecks(github, () => now);
  return { github, checks, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('SkillUpdateChecks', () => {
  it('finds a higher tag for a version ref and a moved branch for a branch ref', async () => {
    const { checks } = world();
    const tag = record('v1.4', C14);
    const branchMoved = { ...record('main', C14), path: 'x' };
    const branchSame = { ...record('main', MAIN), path: 'y' };
    await checks.check([tag, branchMoved, branchSame]);
    expect(checks.lookOf(tag)).toEqual({ updateAvailable: 'v1.5', checked: '2026-11-13T09:00:00.000Z', checkError: null });
    expect(checks.lookOf(branchMoved).updateAvailable).toBe('main');
    expect(checks.lookOf(branchSame).updateAvailable).toBeNull();
    expect(checks.lookOf(record('v1.5', C15))).toEqual({ updateAvailable: null, checked: null, checkError: null });
  });

  it('asks again only after five minutes or for another ref, and keeps a failure as the look\'s error', async () => {
    const { github, checks, advance } = world();
    await checks.check([record('v1.4', C14)]);
    await checks.check([record('v1.4', C14)]);
    expect(github.calls).toHaveLength(1);
    advance(6 * 60_000);
    github.failNext = new GithubError('rate_limited', 'limit reached');
    await checks.check([record('v1.4', C14)]);
    expect(checks.lookOf(record('v1.4', C14))).toMatchObject({ updateAvailable: null, checkError: 'limit reached' });
    await checks.check([record('v1.5', C15)]);
    expect(github.calls).toHaveLength(3);
  });
});
