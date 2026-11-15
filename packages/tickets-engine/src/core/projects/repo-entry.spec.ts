import { describe, expect, it } from 'vitest';
import type { RepoRef } from '../../contracts/repo-ref';
import { chooseRepoEntry, sameCheckoutPath } from './repo-entry';

const repo = (name: string, url: string, path: string | null): RepoRef => ({ name, url, branch: null, policy: null, path, worker: null, worktrees: null, launch: null, instructions: null });
const seed = { name: 'drey', url: 'https://example.com/drey.git', branch: 'main', path: 'E:/projects/drey' };

describe('sameCheckoutPath', () => {
  it('ignores separators, a trailing slash and the case of a drive path', () => {
    expect(sameCheckoutPath('e:\\projects\\drey\\', 'E:/projects/drey')).toBe(true);
    expect(sameCheckoutPath('/a/Drey', '/a/drey')).toBe(false);
    expect(sameCheckoutPath('E:/a', 'E:/b')).toBe(false);
  });
});

describe('chooseRepoEntry (req-304)', () => {
  it('adds a new entry under the folder name', () => {
    const choice = chooseRepoEntry([], seed);
    expect(choice.name).toBe('drey');
    expect(choice.add).toMatchObject({ name: 'drey', url: seed.url, branch: 'main', path: seed.path, policy: null });
  });

  it('reuses the entry that names this checkout', () => {
    expect(chooseRepoEntry([repo('main-app', 'https://x/y.git', 'e:/projects/drey')], seed)).toEqual({ name: 'main-app', add: null });
  });

  it('reuses an entry without a path when the url is the same', () => {
    expect(chooseRepoEntry([repo('drey', seed.url, null)], seed)).toEqual({ name: 'drey', add: null });
  });

  it('numbers the name when another checkout holds it', () => {
    const repos = [repo('drey', seed.url, 'E:/elsewhere/drey'), repo('drey-2', seed.url, 'E:/third/drey')];
    const choice = chooseRepoEntry(repos, seed);
    expect(choice.name).toBe('drey-3');
    expect(choice.add?.path).toBe('E:/projects/drey');
  });
});
