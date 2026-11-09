import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import type { TreeMode } from '../ports/tree-mode';
import type { RunInfo, RunRequest } from '../protocol';
import type { LiveRun } from './live-run';
import { ReviewCheckout, type ReviewGit } from './review-checkout';

const CHECKOUT = 'V:/tickets/_worktrees/T-0001-review';
const BUILT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const LATER = 'ffffeeeeddddccccbbbbaaaa9999888877776666';

/** A git that answers rev-parse with the branch head and records every command; `worktree add` creates the folder in the fake disk. */
class FakeGit implements ReviewGit {
  readonly calls: string[] = [];
  head: string | null = BUILT;

  constructor(private readonly fs: MemoryFileSystem) {}

  async run(cwd: string, args: readonly string[]): Promise<string> {
    this.calls.push(`${cwd}: ${args.join(' ')}`);
    if (args[0] === 'rev-parse') {
      if (this.head === null) {
        throw new Error('fatal: Needed a single revision');
      }
      return `${this.head}\n`;
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      this.fs.files.set(`${args[3]}/src/a.ts`, 'export {};');
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      for (const key of [...this.fs.files.keys()].filter((k) => k.startsWith(`${args[3]}/`))) {
        this.fs.files.delete(key);
      }
    }
    return '';
  }
}

class FakeTreeMode implements TreeMode {
  readonly calls: string[] = [];
  fail = false;

  async setReadOnly(root: string, readOnly: boolean): Promise<void> {
    this.calls.push(`${readOnly ? 'lock' : 'unlock'} ${root}`);
    if (this.fail && readOnly) {
      throw new Error('EPERM');
    }
  }
}

function request(over: Partial<RunRequest> = {}): RunRequest {
  return { ticketId: 'T-0001', repoPath: 'W:/drey', branch: 't/T-0001', reviewCheckout: CHECKOUT, ...over } as RunRequest;
}

function runWith(review: RunInfo['review'], over: Partial<RunRequest> = {}): LiveRun {
  return { request: request(over), info: { review } as RunInfo } as LiveRun;
}

function setup(): { fs: MemoryFileSystem; git: FakeGit; mode: FakeTreeMode; lines: string[]; checkout: ReviewCheckout } {
  const fs = new MemoryFileSystem();
  const git = new FakeGit(fs);
  const mode = new FakeTreeMode();
  const lines: string[] = [];
  return { fs, git, mode, lines, checkout: new ReviewCheckout({ git, mode, fs, log: (line) => lines.push(line) }) };
}

describe('ReviewCheckout — the review reads a detached, read-only checkout of the handed-over commit (req-183)', () => {
  it('opens a second worktree detached at the branch head and locks it on disk', async () => {
    const { git, mode, checkout } = setup();
    expect(await checkout.open(request())).toEqual({ checkout: CHECKOUT, commit: BUILT });
    expect(git.calls).toEqual([`W:/drey: rev-parse --verify refs/heads/t/T-0001^{commit}`, `W:/drey: worktree add --detach ${CHECKOUT} ${BUILT}`]);
    expect(mode.calls).toEqual([`lock ${CHECKOUT}`]);
  });

  it('a request without a review checkout opens nothing', async () => {
    const { git, checkout } = setup();
    expect(await checkout.open(request({ reviewCheckout: undefined }))).toBeNull();
    expect(git.calls).toEqual([]);
  });

  it('refuses when the branch does not exist: nothing was handed over', async () => {
    const { git, checkout } = setup();
    git.head = null;
    await expect(checkout.open(request())).rejects.toThrow('nothing was handed over to review');
    expect(git.calls.some((c) => c.includes('worktree add'))).toBe(false);
  });

  it('a leftover checkout at the path is unlocked and removed first', async () => {
    const { fs, git, mode, lines, checkout } = setup();
    fs.files.set(`${CHECKOUT}/old.ts`, 'x');
    await checkout.open(request());
    expect(mode.calls[0]).toBe(`unlock ${CHECKOUT}`);
    expect(git.calls.findIndex((c) => c.includes('worktree remove --force'))).toBeLessThan(git.calls.findIndex((c) => c.includes('worktree add')));
    expect(lines[0]).toContain('leftover review checkout');
  });

  it('a checkout that cannot be locked is removed again and the start fails', async () => {
    const { fs, mode, checkout } = setup();
    mode.fail = true;
    await expect(checkout.open(request())).rejects.toThrow('could not be made read-only');
    expect(await fs.exists(CHECKOUT)).toBe(false);
  });

  it('the gate passes while the branch still points at the reviewed commit', async () => {
    const { checkout } = setup();
    expect(await checkout.moved(runWith({ checkout: CHECKOUT, commit: BUILT }))).toBeNull();
  });

  it('a later commit on the branch fails the review with both commits named', async () => {
    const { git, checkout } = setup();
    git.head = LATER;
    const failure = await checkout.moved(runWith({ checkout: CHECKOUT, commit: BUILT }));
    expect(failure).toContain('moved after the review began');
    expect(failure).toContain(BUILT.slice(0, 10));
    expect(failure).toContain(LATER.slice(0, 10));
  });

  it('a run without a review checkout is never asked', async () => {
    const { git, checkout } = setup();
    expect(await checkout.moved(runWith(undefined))).toBeNull();
    expect(git.calls).toEqual([]);
  });

  it('close unlocks, removes and prunes', async () => {
    const { fs, git, mode, checkout } = setup();
    await checkout.open(request());
    await checkout.close(runWith({ checkout: CHECKOUT, commit: BUILT }));
    expect(mode.calls.at(-1)).toBe(`unlock ${CHECKOUT}`);
    expect(git.calls.slice(-2)).toEqual([`W:/drey: worktree remove --force ${CHECKOUT}`, 'W:/drey: worktree prune']);
    expect(await fs.exists(CHECKOUT)).toBe(false);
  });

  it('a removal that leaves the folder behind is a log line, never a throw', async () => {
    const { fs, git, lines, checkout } = setup();
    fs.files.set(`${CHECKOUT}/stuck.ts`, 'x');
    git.run = async () => '';
    await checkout.close(runWith({ checkout: CHECKOUT, commit: BUILT }));
    expect(lines[0]).toContain('could not be removed');
  });
});
