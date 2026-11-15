import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../../core/git/tickets-git';
import type { RunRequest } from '../protocol';
import { parseWorktreePorcelain, prepareWorktree } from './worktrees';
import { BRANCH, execFileAsync, frozen, git, makeRepo, removeRepo, type RepoFixture } from './worktrees-git.fake';

/**
 * The worktree state machine (T-0047) against the installed git: parsing
 * the porcelain listing, creating, reusing and re-creating, and the
 * `link:` folders. The leftover shapes and refusals are in
 * `worktrees-leftovers.spec.ts`; the supervisor's wiring is beside
 * `orchestrate/run-starter.ts`.
 */

describe('parseWorktreePorcelain', () => {
  it('parses healthy, detached, locked (with reason) and prunable entries', () => {
    const recorded = [
      'worktree C:/repos/drey',
      'HEAD 0000000000000000000000000000000000000001',
      'branch refs/heads/main',
      '',
      'worktree C:/wt/a',
      'HEAD 0000000000000000000000000000000000000002',
      'detached',
      '',
      'worktree C:/wt/b',
      'HEAD 0000000000000000000000000000000000000003',
      'branch refs/heads/t/T-0091',
      'locked rebase in progress',
      '',
      'worktree C:/wt/c',
      'HEAD 0000000000000000000000000000000000000004',
      'branch refs/heads/t/T-0092',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const entries = parseWorktreePorcelain(recorded);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      path: 'C:/repos/drey',
      branch: 'refs/heads/main',
      detached: false,
      locked: false,
      prunable: false,
    });
    expect(entries[1]).toEqual({
      path: 'C:/wt/a',
      branch: null,
      detached: true,
      locked: false,
      prunable: false,
    });
    expect(entries[2]).toEqual({
      path: 'C:/wt/b',
      branch: 'refs/heads/t/T-0091',
      detached: false,
      locked: true,
      prunable: false,
    });
    expect(entries[3]).toEqual({
      path: 'C:/wt/c',
      branch: 'refs/heads/t/T-0092',
      detached: false,
      locked: false,
      prunable: true,
    });
  });
});
describe('prepareWorktree (real git)', () => {
  let fixture: RepoFixture;
  let baseDir = '';
  let repo = '';
  let worktreePath = '';
  let adminName = '';

  beforeEach(async () => {
    fixture = await makeRepo();
    ({ baseDir, repo, worktreePath, adminName } = fixture);
  });

  afterEach(async () => {
    await removeRepo(fixture);
  });

  const fleetGit = (): TicketsGit => new TicketsGit(() => 'git');
  const req = (overrides: Partial<Pick<RunRequest, 'repoPath' | 'branch' | 'baseRef' | 'links'>> = {}) => ({
    repoPath: repo,
    branch: BRANCH,
    baseRef: 'main',
    ...overrides,
  });
  const headOf = async (dir: string): Promise<string> => (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const listing = async (): Promise<string> => await git(repo, ['worktree', 'list', '--porcelain']);
  const siblings = async (): Promise<readonly string[]> => await fsp.readdir(path.dirname(worktreePath));

  it('creates a fresh worktree from the base ref when nothing exists', async () => {
    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result).toEqual({ outcome: 'created', sessionInvalidated: false, movedTo: null });
    expect(await headOf(worktreePath)).toBe(BRANCH);
    await expect(git(repo, ['rev-parse', '--verify', `refs/heads/${BRANCH}`])).resolves.toBeDefined();
  });

  it('creates over an existing empty directory', async () => {
    await fsp.mkdir(worktreePath, { recursive: true });
    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result).toEqual({ outcome: 'created', sessionInvalidated: false, movedTo: null });
    expect(await headOf(worktreePath)).toBe(BRANCH);
  });

  it('reuses a registered worktree and its dirty state survives (retry keeps the half-finished work)', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'edited\n');
    await fsp.writeFile(path.join(worktreePath, 'untracked.txt'), 'new\n');

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result).toEqual({ outcome: 'reused', sessionInvalidated: false, movedTo: null });
    await expect(fsp.readFile(path.join(worktreePath, 'file.txt'), 'utf8')).resolves.toBe('edited\n');
    await expect(fsp.readFile(path.join(worktreePath, 'untracked.txt'), 'utf8')).resolves.toBe('new\n');
    expect(await siblings()).toEqual([adminName]);
  });

  it.skipIf(process.platform !== 'win32')(
    'reuses a worktree reached through a path alias (git reports the canonical path)',
    async () => {
      // The GitHub Windows runner's temp dir is an 8.3 short name
      // (`RUNNER~1` for `runneradmin`): git registers and reports the
      // canonical long path, so the requested path is an alias of the
      // listed one. A junction reproduces that shape on any checkout.
      const aliasBase = `${baseDir}-alias`;
      await execFileAsync('cmd', ['/c', 'mklink', '/J', aliasBase, baseDir], { windowsHide: true });
      try {
        const aliasPath = path.join(aliasBase, 'fleet-root', 'worktrees', 'repo-T-0091');
        await prepareWorktree({ git: fleetGit(), request: req(), worktreePath: aliasPath, now: frozen });
        await fsp.writeFile(path.join(aliasPath, 'untracked.txt'), 'kept\n');

        const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath: aliasPath, now: frozen });
        expect(result).toEqual({ outcome: 'reused', sessionInvalidated: false, movedTo: null });
        await expect(fsp.readFile(path.join(aliasPath, 'untracked.txt'), 'utf8')).resolves.toBe(
          'kept\n',
        );
        expect(await siblings()).toEqual([adminName]);
      } finally {
        await execFileAsync('cmd', ['/c', 'rmdir', aliasBase], { windowsHide: true });
      }
    },
  );

  it('re-creates a removed worktree with the branch history intact', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await git(worktreePath, ['commit', '--allow-empty', '-m', 'worktree work']);
    const tip = (await git(repo, ['rev-parse', BRANCH])).trim();
    await fsp.rm(worktreePath, { recursive: true, force: true });

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result).toEqual({ outcome: 'created', sessionInvalidated: false, movedTo: null });
    expect((await git(repo, ['rev-parse', BRANCH])).trim()).toBe(tip);
    expect(await headOf(worktreePath)).toBe(BRANCH);
  });

  // --- the re-run trap (T-0044): the branch checked out elsewhere ---

  /** A leftover registration of the branch somewhere else — the settled
   *  ticket's checkout in another base (the legacy fleet root). */
  const legacyConflict = async (): Promise<string> => {
    const legacy = path.join(baseDir, 'legacy-root', 'worktrees', 'repo-T-0091');
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath: legacy, now: frozen });
    return legacy;
  };

  it('removes a clean conflicting registration when it is not live, then creates', async () => {
    const legacy = await legacyConflict();

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen, isLive: () => false });
    expect(result).toEqual({ outcome: 'created', sessionInvalidated: false, movedTo: null });
    expect(await headOf(worktreePath)).toBe(BRANCH);
    // The conflicting registration and its folder are gone (real git
    // remove, branch untouched).
    expect(await listing()).not.toContain(legacy.replaceAll('\\', '/'));
    await expect(fsp.stat(legacy)).rejects.toThrow();
    expect((await git(repo, ['rev-parse', BRANCH])).trim()).toBeDefined();
  });

  it('refuses descriptively when the conflicting registration is live', async () => {
    const legacy = await legacyConflict();

    const refused = prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen, isLive: (p) =>
      p.replaceAll('\\', '/') === legacy.replaceAll('\\', '/') });
    await expect(refused).rejects.toThrow('live run');
    await expect(fsp.stat(legacy)).resolves.toBeDefined();
  });

  it('refuses when the conflicting registration is dirty — nothing is destroyed', async () => {
    const legacy = await legacyConflict();
    await fsp.writeFile(path.join(legacy, 'uncommitted.txt'), 'half-finished\n');

    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen })).rejects.toThrow(
      'dirty worktree',
    );
    await expect(fsp.readFile(path.join(legacy, 'uncommitted.txt'), 'utf8')).resolves.toBe(
      'half-finished\n',
    );
  });

  it('recreates a stale clean worktree (registration lost, tree still runnable)', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    // The verified leftover: the admin gitdir file is gone — the entry
    // vanishes from the list while the directory still answers to git.
    await fsp.rm(path.join(repo, '.git', 'worktrees', adminName, 'gitdir'));

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result).toEqual({ outcome: 'recreated', sessionInvalidated: true, movedTo: null });
    expect(await listing()).toContain(`branch refs/heads/${BRANCH}`);
    expect(await headOf(worktreePath)).toBe(BRANCH);
  });

  describe('link: — the toolchain folders a worktree borrows (req-56)', () => {
    beforeEach(async () => {
      await fsp.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n.tools/\n');
      await git(repo, ['add', '.gitignore']);
      await git(repo, ['commit', '-m', 'ignore']);
      await fsp.mkdir(path.join(repo, 'node_modules', 'pkg'), { recursive: true });
      await fsp.writeFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'shared\n');
    });

    it('links an ignored folder the checkout has, and reports the rest', async () => {
      const result = await prepareWorktree({ git: fleetGit(), request: { ...req(), links: ['node_modules', '.tools', 'file.txt'] }, worktreePath, now: frozen });
      expect(result.links).toEqual({
        linked: ['node_modules'],
        present: ['file.txt'],
        skipped: [{ path: '.tools', reason: 'the checkout has no such folder' }],
      });
      await expect(fsp.readFile(path.join(worktreePath, 'node_modules', 'pkg', 'index.js'), 'utf8')).resolves.toBe('shared\n');
      expect((await fsp.lstat(path.join(worktreePath, 'node_modules'))).isSymbolicLink()).toBe(true);
      expect((await git(worktreePath, ['status', '--porcelain'])).trim()).toBe('');
    });

    it('leaves out a folder git would see as a change', async () => {
      await fsp.mkdir(path.join(repo, 'tracked-dir'));
      const result = await prepareWorktree({ git: fleetGit(), request: { ...req(), links: ['tracked-dir'] }, worktreePath, now: frozen });
      expect(result.links?.skipped).toEqual([
        { path: 'tracked-dir', reason: 'git does not ignore it — a link would show as a change' },
      ]);
    });

    it('a reused worktree keeps its link; a recreate removes it first and never empties the checkout', async () => {
      await prepareWorktree({ git: fleetGit(), request: { ...req(), links: ['node_modules'] }, worktreePath, now: frozen });
      expect((await prepareWorktree({ git: fleetGit(), request: { ...req(), links: ['node_modules'] }, worktreePath, now: frozen })).links?.present).toEqual([
        'node_modules',
      ]);
      await fsp.rm(path.join(repo, '.git', 'worktrees', adminName, 'gitdir'));
      const result = await prepareWorktree({ git: fleetGit(), request: { ...req(), links: ['node_modules'] }, worktreePath, now: frozen });
      expect(result.outcome).toBe('recreated');
      expect(result.links?.linked).toEqual(['node_modules']);
      await expect(fsp.readFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'utf8')).resolves.toBe('shared\n');
    });
  });

});
