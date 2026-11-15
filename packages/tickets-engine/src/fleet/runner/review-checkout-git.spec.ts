import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../../core/git/tickets-git';
import { NodeFileSystem } from './node-file-system';
import { NodeTreeMode } from '../worktrees/node-tree-mode';
import type { LiveRun } from './live-run';
import { ReviewCheckout } from '../worktrees/review-checkout';
import type { RunInfo, RunRequest } from '../protocol';
import { removeWorktree } from '../worktrees/worktree-clean';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args], { cwd, windowsHide: true, encoding: 'utf8' });
  return stdout;
}

/** req-183 against the installed git: the review checkout is a real detached worktree, read-only on disk, removed at the end. */
describe('ReviewCheckout (real git)', () => {
  let baseDir = '';
  let repo = '';
  let builder = '';
  let checkout = '';
  const lines: string[] = [];
  const review = (): ReviewCheckout => new ReviewCheckout({ git: new TicketsGit(() => 'git'), mode: new NodeTreeMode(), fs: new NodeFileSystem(), log: (l) => lines.push(l) });
  const request = (): RunRequest => ({ ticketId: 'T-0001', repoPath: repo, branch: 't/T-0001', reviewCheckout: checkout }) as RunRequest;
  const runOf = (info: RunInfo['review']): LiveRun => ({ request: request(), info: { review: info } as RunInfo }) as LiveRun;

  beforeEach(async () => {
    baseDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-review-')));
    repo = path.join(baseDir, 'repo');
    builder = path.join(baseDir, 'vault', '_worktrees', 'T-0001');
    checkout = path.join(baseDir, 'vault', '_worktrees', 'T-0001-review');
    await fsp.mkdir(repo);
    await git(repo, ['init', '-b', 'main']);
    await fsp.writeFile(path.join(repo, 'file.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'initial']);
    await git(repo, ['worktree', 'add', '-b', 't/T-0001', builder]);
    await fsp.writeFile(path.join(builder, 'file.txt'), 'built\n');
    await git(builder, ['commit', '-am', 'the build']);
  });

  afterEach(async () => {
    await new NodeTreeMode().setReadOnly(checkout, false).catch(() => undefined);
    await fsp.rm(baseDir, { recursive: true, force: true });
  });

  it('opens a detached checkout at the builder’s commit that refuses writes, and removes it again', async () => {
    const built = (await git(builder, ['rev-parse', 'HEAD'])).trim();
    const opened = await review().open(request());
    expect(opened).toEqual({ checkout, commit: built });
    expect((await git(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(built);
    expect(await git(checkout, ['status', '--porcelain', '--branch'])).toContain('HEAD (no branch)');
    expect((await fsp.readFile(path.join(checkout, 'file.txt'), 'utf8')).trim()).toBe('built'); // autocrlf may check it out with CRLF
    await expect(fsp.writeFile(path.join(checkout, 'file.txt'), 'the reviewer fixes it\n')).rejects.toThrow();
    await review().close(runOf(opened!));
    await expect(fsp.access(checkout)).rejects.toThrow();
    expect(await git(repo, ['worktree', 'list'])).not.toContain('T-0001-review');
  });

  it('a commit on the branch after the review opened fails the review', async () => {
    const opened = await review().open(request());
    expect(await review().moved(runOf(opened!))).toBeNull();
    await fsp.writeFile(path.join(builder, 'file.txt'), 'after the hand-over\n');
    await git(builder, ['commit', '-am', 'a late change']);
    expect(await review().moved(runOf(opened!))).toContain('moved after the review began');
    await review().close(runOf(opened!));
  });

  it('a leftover checkout from a killed runner is cleared before the next review opens', async () => {
    await review().open(request());
    const again = await review().open(request());
    expect(again?.checkout).toBe(checkout);
    expect(lines.some((l) => l.includes('leftover review checkout'))).toBe(true);
    await review().close(runOf(again!));
  });

  it('Clean up (removeWorktree) removes a read-only review checkout', async () => {
    await review().open(request());
    expect(await removeWorktree(new TicketsGit(() => 'git'), repo, checkout)).toEqual({ ok: true });
    await expect(fsp.access(checkout)).rejects.toThrow();
  });
});
