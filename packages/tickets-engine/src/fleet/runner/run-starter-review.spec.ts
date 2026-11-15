import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TreeMode } from '../ports/tree-mode';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from '../lease/ticket-store.fake';
import { settled } from './run-spec-support';
import { buildRequest, endTurn, harness, liveRun, startRun, streamText, useTempDirs, type Harness } from './supervisor-harness.fake';

const BUILT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const LATER = 'ffffeeeeddddccccbbbbaaaa9999888877776666';

/** The supervisor's git for these specs: the branch head is a variable, `worktree add/remove` make and drop the folder. */
class BranchGit {
  head = BUILT;
  readonly calls: string[] = [];

  async run(_cwd: string, args: readonly string[]): Promise<string> {
    this.calls.push(args.join(' '));
    if (args[0] === 'rev-parse') {
      return `${this.head}\n`;
    }
    if (args[1] === 'add') {
      await fsp.mkdir(args[3]!, { recursive: true });
    }
    if (args[1] === 'remove') {
      await fsp.rm(args[3]!, { recursive: true, force: true });
    }
    return '';
  }

  async locate(): Promise<null> {
    return null;
  }

  async commitPaths(): Promise<void> {}

  async push(): Promise<void> {}
}

class RecordingTreeMode implements TreeMode {
  readonly calls: string[] = [];

  async setReadOnly(root: string, readOnly: boolean): Promise<void> {
    this.calls.push(`${readOnly ? 'lock' : 'unlock'} ${path.basename(root)}`);
  }
}

/** req-183: the review run reads its own read-only checkout; a commit after the hand-over fails the review. */
describe('RunStarter — a review run in its read-only checkout (req-183)', () => {
  const dirs = useTempDirs();
  const checkout = (): string => path.join(dirs.vault, '_worktrees', 'T-0001-review');
  const review = (over: Partial<RunRequest> = {}): RunRequest =>
    buildRequest(dirs.vault, { worktreePath: path.join(dirs.vault, '_worktrees', 'T-0001'), reviewCheckout: checkout(), ...over });

  const setup = (): Harness & { git: BranchGit; mode: RecordingTreeMode; cwds: string[] } => {
    const git = new BranchGit();
    const mode = new RecordingTreeMode();
    const cwds: string[] = [];
    const built = harness(dirs.fleet, { ticketsGit: git, treeMode: mode, execShell: async (_command, cwd) => void cwds.push(cwd) }, new FakeTicketStore());
    return { ...built, git, mode, cwds };
  };

  it('the reviewer works in <id>-review, detached at the branch head and locked; the record and the stream say so', async () => {
    const t = setup();
    const id = await startRun(t.sup, review());
    expect(t.adapter.starts[0]!.cwd).toBe(checkout());
    expect(t.git.calls).toContain(`worktree add --detach ${checkout()} ${BUILT}`);
    expect(t.mode.calls).toEqual(['lock T-0001-review']);
    expect(t.sup.get(id)?.review).toEqual({ checkout: checkout(), commit: BUILT });
    expect(t.sup.get(id)?.worktreePath).toBe(path.join(dirs.vault, '_worktrees', 'T-0001'));
    expect(await streamText(dirs.fleet, id)).toContain('review checkout');
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
  });

  it('an unchanged branch passes: the gate runs in the worktree, then the checkout is unlocked and removed', async () => {
    const t = setup();
    const id = await startRun(t.sup, review());
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.cwds).toEqual([path.join(dirs.vault, '_worktrees', 'T-0001')]);
    expect(t.mode.calls).toEqual(['lock T-0001-review', 'unlock T-0001-review']);
    expect(t.git.calls).toContain(`worktree remove --force ${checkout()}`);
    await expect(fsp.access(checkout())).rejects.toThrow();
  });

  it('a builder commit after the hand-over fails the review — no gate command runs, nothing moves', async () => {
    const t = setup();
    const id = await startRun(t.sup, review());
    t.git.head = LATER; // the builder (or anyone) committed while the reviewer read the tree
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'failed');
    const info = t.sup.get(id)!;
    expect(info.gateResult).toBe('red');
    expect(info.gateFailure).toContain('moved after the review began');
    expect(t.cwds).toEqual([]);
    expect(t.store.of('release').map((c) => c.stage)).not.toContain('commit');
    await expect(fsp.access(checkout())).rejects.toThrow();
  });

  it('a review never starts while the builder’s run is detached — its worker may still write', async () => {
    const t = setup();
    const build = await startRun(t.sup, buildRequest(dirs.vault, { worktreePath: path.join(dirs.vault, '_worktrees', 'T-0001') }));
    const run = liveRun(t.sup, build);
    run.info = { ...run.info, state: 'detached' };
    const outcome = await t.sup.start(review());
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.error).toContain('detached run');
    expect(t.git.calls.some((c) => c.startsWith('worktree add'))).toBe(false);
  });

  it('a run without a review checkout works in its worktree as before', async () => {
    const t = setup();
    const id = await startRun(t.sup, buildRequest(dirs.vault, { worktreePath: path.join(dirs.vault, '_worktrees', 'T-0001') }));
    expect(t.adapter.starts[0]!.cwd).toBe(path.join(dirs.vault, '_worktrees', 'T-0001'));
    expect(t.sup.get(id)?.review).toBeUndefined();
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.mode.calls).toEqual([]);
  });
});
