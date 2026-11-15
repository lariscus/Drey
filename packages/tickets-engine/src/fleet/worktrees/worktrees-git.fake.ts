import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

/**
 * The real-git fixture of the worktree specs (T-0047): the behaviour *is*
 * git state, so every case builds the real leftover shapes in a temp repo.
 */

export const execFileAsync = promisify(execFile);

/** Plain git with a commit identity, outside any seam. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
  });
  return stdout;
}

export const BRANCH = 't/T-0091';

/** Frozen clock — makes the `.stale-<stamp>` name and its collision suffixes deterministic. */
export const frozen = (): Date => new Date('2026-10-19T01:02:03Z');

export interface RepoFixture {
  readonly baseDir: string;
  readonly repo: string;
  /** A nested path on purpose: preparation must create the parent. */
  readonly worktreePath: string;
  /** The worktree's admin dir name inside `<repo>/.git/worktrees/`. */
  readonly adminName: string;
}

/**
 * A repo with one commit on `main`. Canonical from the start: the runner's
 * temp dir can be an alias (the GitHub Windows runner's 8.3 `RUNNER~1`)
 * while git reports canonical long paths — alias behaviour has its own
 * junction test, never the temp dir's accident.
 */
export async function makeRepo(): Promise<RepoFixture> {
  const baseDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-wt-')));
  const repo = path.join(baseDir, 'repo');
  await fsp.mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await fsp.writeFile(path.join(repo, 'file.txt'), 'one\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'initial']);
  const worktreePath = path.join(baseDir, 'fleet-root', 'worktrees', 'repo-T-0091');
  return { baseDir, repo, worktreePath, adminName: path.basename(worktreePath) };
}

export async function removeRepo(fixture: RepoFixture): Promise<void> {
  await fsp.rm(fixture.baseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
