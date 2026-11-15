import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../../core/git/tickets-git';
import type { RunRequest } from '../protocol';
import { parseWorktreePorcelain, prepareWorktree } from './worktrees';
import { BRANCH, frozen, git, makeRepo, removeRepo, type RepoFixture } from './worktrees-git.fake';

/**
 * The worktree state machine (T-0047), the leftovers: stale dirty or
 * uninspectable trees moved aside, the wrong branch, the walk-up trap,
 * locked trees and trees mid-merge or mid-rebase — refused, nothing
 * destroyed — and two concurrent prepares on one path.
 */

describe('prepareWorktree (real git): leftovers and refusals', () => {
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

  it('moves a stale dirty worktree aside, keeps it, and checks out fresh', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await fsp.writeFile(path.join(worktreePath, 'uncommitted.txt'), 'half-finished\n');
    await fsp.rm(path.join(repo, '.git', 'worktrees', adminName, 'gitdir'));

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result.outcome).toBe('moved-aside');
    expect(result.sessionInvalidated).toBe(true);
    expect(result.movedTo).toBe(`${worktreePath}.stale-20261019T010203`);
    await expect(fsp.readFile(path.join(result.movedTo!, 'uncommitted.txt'), 'utf8')).resolves.toBe(
      'half-finished\n',
    );
    // The original path holds a fresh, clean checkout of the branch.
    expect(await headOf(worktreePath)).toBe(BRANCH);
    expect((await git(worktreePath, ['status', '--porcelain'])).trim()).toBe('');
  });

  it('suffixes the stamp when the frozen clock collides', async () => {
    for (const suffix of ['', '-2']) {
      await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
      await fsp.writeFile(path.join(worktreePath, 'uncommitted.txt'), `half-finished${suffix}\n`);
      await fsp.rm(path.join(repo, '.git', 'worktrees', adminName, 'gitdir'));
      const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
      expect(result.outcome).toBe('moved-aside');
      expect(result.movedTo).toBe(`${worktreePath}.stale-20261019T010203${suffix}`);
    }
  });

  it('moves a stale uninspectable directory aside instead of deleting it', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await fsp.writeFile(path.join(worktreePath, 'notes.txt'), 'keep me\n');
    // The verified leftover: `<wt>/.git` is gone — the tree cannot
    // answer to git, so cleanliness cannot be proven.
    await fsp.rm(path.join(worktreePath, '.git'));

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    expect(result.outcome).toBe('moved-aside');
    expect(result.sessionInvalidated).toBe(true);
    await expect(fsp.readFile(path.join(result.movedTo!, 'notes.txt'), 'utf8')).resolves.toBe('keep me\n');
    expect(await headOf(worktreePath)).toBe(BRANCH);
  });

  it('refuses a registered worktree on the wrong branch and modifies nothing', async () => {
    await git(repo, ['branch', 'other']);
    const foreign = path.join(baseDir, 'wt-other');
    await git(repo, ['worktree', 'add', foreign, 'other']);
    await fsp.writeFile(path.join(foreign, 'uncommitted.txt'), 'keep\n');

    const before = await listing();
    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath: foreign, now: frozen })).rejects.toThrow(
      'is on refs/heads/other, expected t/T-0091 — refusing to touch it',
    );
    expect(await listing()).toBe(before);
    await expect(fsp.readFile(path.join(foreign, 'uncommitted.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('still refuses an unregistered folder that is its own repo on the wrong branch', async () => {
    const stray = path.join(baseDir, 'stray-repo');
    await fsp.mkdir(stray);
    await git(stray, ['init', '-b', 'main']);
    await fsp.writeFile(path.join(stray, 'file.txt'), 'committed elsewhere\n');
    await git(stray, ['add', '.']);
    await git(stray, ['commit', '-m', 'initial']);
    await fsp.writeFile(path.join(stray, 'uncommitted.txt'), 'keep\n');

    const before = await listing();
    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath: stray, now: frozen })).rejects.toThrow(
      'is on main, expected t/T-0091 — refusing to touch it',
    );
    expect(await listing()).toBe(before);
    await expect(fsp.readFile(path.join(stray, 'uncommitted.txt'), 'utf8')).resolves.toBe('keep\n');
  });

  it('moves a junction-leftover folder inside a git vault aside instead of refusing (the walk-up trap)', async () => {
    // The production shape: the worktree base lives inside the tickets
    // vault — itself a git repo on `main`. A removal leftover (junctions,
    // no `.git` of its own) made rev-parse answer with the VAULT's
    // branch, and every dispatch was refused forever.
    const vault = path.join(baseDir, 'vault-repo');
    await fsp.mkdir(vault);
    await git(vault, ['init', '-b', 'main']);
    const trap = path.join(vault, '_worktrees', 'T-0091');
    await fsp.mkdir(trap, { recursive: true });
    const shared = path.join(baseDir, 'shared-tools');
    await fsp.mkdir(shared);
    await fsp.symlink(shared, path.join(trap, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await prepareWorktree({ git: fleetGit(), request: req(), worktreePath: trap, now: frozen });
    expect(result.outcome).toBe('moved-aside');
    expect(result.sessionInvalidated).toBe(true);
    expect(await headOf(trap)).toBe(BRANCH);
    // The leftover's content survives in the move-aside, junction included.
    await expect(fsp.stat(path.join(result.movedTo!, 'node_modules'))).resolves.toBeDefined();
    // The junction's target was never touched.
    await expect(fsp.stat(path.join(trap, 'file.txt'))).resolves.toBeDefined();
  });

  it('refuses a locked worktree and modifies nothing', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await fsp.writeFile(path.join(worktreePath, 'uncommitted.txt'), 'dirty\n');
    await git(repo, ['worktree', 'lock', worktreePath]);

    const before = await listing();
    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen })).rejects.toThrow('is locked');
    expect(await listing()).toBe(before);
    expect(await siblings()).toEqual([adminName]);
    await expect(fsp.readFile(path.join(worktreePath, 'uncommitted.txt'), 'utf8')).resolves.toBe('dirty\n');
  });

  /** Diverge repo main and the worktree's branch so a merge or rebase
   *  conflicts and stops mid-operation. */
  const diverge = async (): Promise<void> => {
    await fsp.writeFile(path.join(repo, 'file.txt'), 'three\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'main change']);
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'two\n');
    await git(worktreePath, ['add', '.']);
    await git(worktreePath, ['commit', '-m', 'worktree change']);
  };

  it('refuses a worktree with a merge in progress and modifies nothing', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await diverge();
    await expect(git(worktreePath, ['merge', 'main'])).rejects.toBeDefined();

    const before = await listing();
    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen })).rejects.toThrow(
      'has a merge in progress',
    );
    expect(await listing()).toBe(before);
    expect(await siblings()).toEqual([adminName]);
  });

  it('refuses a worktree with a rebase in progress (detached) and modifies nothing', async () => {
    await prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen });
    await diverge();
    await expect(git(worktreePath, ['rebase', 'main'])).rejects.toBeDefined();

    const before = await listing();
    // A rebase detaches HEAD, so the branch guard fires first.
    await expect(prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen })).rejects.toThrow(
      'is on a detached HEAD, expected t/T-0091 — refusing to touch it',
    );
    expect(await listing()).toBe(before);
    expect(await siblings()).toEqual([adminName]);
    // The rebase is still in progress — nothing was touched.
    const marker = (await git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge'])).trim();
    await expect(fsp.stat(marker)).resolves.toBeDefined();
  });

  it('serializes two concurrent prepares on one path (exactly one add)', async () => {
    // Two independent seams: the module-level lock, not the git queue,
    // must serialize them.
    const [first, second] = await Promise.all([
      prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen }),
      prepareWorktree({ git: fleetGit(), request: req(), worktreePath, now: frozen }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['created', 'reused']);
    const mine = parseWorktreePorcelain(await listing()).filter((e) => e.path.endsWith(adminName));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.branch).toBe(`refs/heads/${BRANCH}`);
  });
});
