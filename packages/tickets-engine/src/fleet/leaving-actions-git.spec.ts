import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../core/tickets-git';
import { CommitAction } from './orchestrate/commit-action';
import { MainRef } from './orchestrate/main-ref';
import { SyncMainAction } from './orchestrate/sync-main-action';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true, encoding: 'utf8' });
  return stdout;
}

/** The engine's git with the spec's identity, so a merge commit needs no global config. */
function engineGit(): TicketsGit {
  return new TicketsGit(
    () => 'git',
    async (exe, args, cwd) => {
      try {
        const { stdout } = await execFileAsync(exe, ['-c', 'user.name=drey', '-c', 'user.email=drey@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true, encoding: 'utf8' });
        return stdout;
      } catch (error) {
        const stdout = (error as { stdout?: unknown }).stdout;
        if (error instanceof Error && typeof stdout === 'string' && stdout.trim() !== '') {
          error.message = `${error.message}\n${stdout.trim()}`;
        }
        throw error;
      }
    },
  );
}

async function commitFile(cwd: string, file: string, text: string, message: string): Promise<void> {
  await fsp.writeFile(path.join(cwd, file), text);
  await git(cwd, ['add', file]);
  await git(cwd, ['commit', '-m', message]);
}

/** req-267 against the installed git: a bare remote, the owner's clone with `main` tracking it, the ticket's worktree on `t/T-0001`. */
describe('leaving actions (real git)', () => {
  let base = '';
  let remote = '';
  let repo = '';
  let worktree = '';
  let scratch = '';
  let other = '';
  const actions = (): { sync: SyncMainAction; commit: CommitAction } => {
    const g = engineGit();
    const main = new MainRef(g);
    return { sync: new SyncMainAction(g, main), commit: new CommitAction(g, main) };
  };
  const commitInput = (over: { policy?: string | null } = {}) => ({
    repoPath: repo,
    worktree,
    ticketBranch: 't/T-0001',
    integrationBranch: 'main',
    policy: over.policy ?? null,
    scratch,
    message: 'Merge t/T-0001 (T-0001)',
  });

  /** Another clone lands a commit on the remote's main: the owner's clone does not have it yet. */
  async function landElsewhere(file: string, text: string): Promise<void> {
    await commitFile(other, file, text, `elsewhere: ${file}`);
    await git(other, ['push', 'origin', 'main']);
  }

  beforeEach(async () => {
    base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-leaving-')));
    remote = path.join(base, 'remote.git');
    repo = path.join(base, 'repo');
    other = path.join(base, 'other');
    worktree = path.join(base, 'vault', '_worktrees', 'T-0001');
    scratch = path.join(base, 'vault', '_worktrees', 'T-0001-commit');
    await git(base, ['init', '--bare', '-b', 'main', remote]);
    await git(base, ['clone', remote, repo]);
    await git(repo, ['checkout', '-b', 'main']).catch(() => '');
    await commitFile(repo, 'a.txt', 'one\n', 'first');
    await git(repo, ['push', '-u', 'origin', 'main']);
    await git(base, ['clone', remote, other]);
    await git(repo, ['worktree', 'add', '-b', 't/T-0001', worktree, 'main']);
    await commitFile(worktree, 'b.txt', 'ticket\n', 'the ticket');
  });

  afterEach(async () => {
    await fsp.rm(base, { recursive: true, force: true, maxRetries: 3 });
  });

  it('sync-main merges the remote main into the branch', async () => {
    await landElsewhere('c.txt', 'other\n');
    const outcome = await actions().sync.run({ repoPath: repo, worktree, integrationBranch: 'main', message: 'Merge main into t/T-0001' });
    expect(outcome.kind).toBe('merged');
    expect(await fsp.readFile(path.join(worktree, 'c.txt'), 'utf8')).toBe('other\n');
  });

  it('sync-main says current when main has nothing new', async () => {
    const outcome = await actions().sync.run({ repoPath: repo, worktree, integrationBranch: 'main', message: 'm' });
    expect(outcome).toEqual({ kind: 'current', main: 'origin/main' });
  });

  it('sync-main aborts a conflict and names the files; the branch is unchanged', async () => {
    const before = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
    await commitFile(worktree, 'a.txt', 'ticket side\n', 'ticket edits a');
    const tip = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
    await landElsewhere('a.txt', 'main side\n');
    const outcome = await actions().sync.run({ repoPath: repo, worktree, integrationBranch: 'main', message: 'm' });
    expect(outcome.kind).toBe('conflict');
    expect(outcome.kind === 'conflict' ? outcome.files : []).toEqual(['a.txt']);
    expect((await git(worktree, ['rev-parse', 'HEAD'])).trim()).toBe(tip);
    expect(tip).not.toBe(before);
    expect((await git(worktree, ['status', '--porcelain'])).trim()).toBe('');
  });

  it('sync-main refuses a dirty worktree', async () => {
    await fsp.writeFile(path.join(worktree, 'loose.txt'), 'x\n');
    expect((await actions().sync.run({ repoPath: repo, worktree, integrationBranch: 'main', message: 'm' })).kind).toBe('failed');
  });

  it('commit merges the branch into the remote main and proves it; the owner checkout is untouched', async () => {
    await landElsewhere('c.txt', 'other\n');
    const ownerHead = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    const outcome = await actions().commit.run(commitInput());
    expect(outcome.kind).toBe('landed');
    await git(other, ['pull', '--ff-only', 'origin', 'main']);
    expect(await fsp.readFile(path.join(other, 'b.txt'), 'utf8')).toBe('ticket\n');
    expect((await git(repo, ['rev-parse', 'HEAD'])).trim()).toBe(ownerHead);
    expect(await fsp.stat(scratch).then(() => true).catch(() => false)).toBe(false);
  });

  it('commit says already landed when main contains the tip', async () => {
    await git(repo, ['push', 'origin', 't/T-0001:main']);
    const outcome = await actions().commit.run(commitInput());
    expect(outcome.kind === 'landed' && outcome.already).toBe(true);
  });

  it('commit aborts a conflict and pushes nothing', async () => {
    await commitFile(worktree, 'a.txt', 'ticket side\n', 'ticket edits a');
    await landElsewhere('a.txt', 'main side\n');
    const remoteMain = (await git(remote, ['rev-parse', 'main'])).trim();
    const outcome = await actions().commit.run(commitInput());
    expect(outcome.kind).toBe('conflict');
    expect((await git(remote, ['rev-parse', 'main'])).trim()).toBe(remoteMain);
  });

  it('commit on a protected branch pushes the work branch and waits for the owner', async () => {
    const outcome = await actions().commit.run(commitInput({ policy: 'pull request' }));
    expect(outcome.kind).toBe('blocked');
    expect((await git(remote, ['rev-parse', 't/T-0001'])).trim()).toBe((await git(worktree, ['rev-parse', 'HEAD'])).trim());
  });

  it('commit without an upstream refuses while the branch is checked out', async () => {
    await git(repo, ['branch', '--unset-upstream', 'main']);
    const outcome = await actions().commit.run(commitInput());
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' ? outcome.reason : '').toContain('checked out');
  });

  it('commit without an upstream moves the local branch when no checkout has it', async () => {
    await git(repo, ['branch', '--unset-upstream', 'main']);
    await git(repo, ['checkout', '--detach']);
    const outcome = await actions().commit.run(commitInput());
    expect(outcome.kind).toBe('landed');
    expect((await git(repo, ['show', 'main:b.txt']))).toBe('ticket\n');
  });
});
