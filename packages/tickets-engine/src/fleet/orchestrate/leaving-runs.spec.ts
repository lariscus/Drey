import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { settled } from './run-spec-support';
import { endTurn, harness, runnerNotes, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

/** A git that answers by the command's first words; every call is recorded. A rule's `fail` rejects with that text. */
function scriptedGit(rules: readonly { readonly when: string; readonly out?: string; readonly fail?: string }[]) {
  const calls: string[] = [];
  const git = {
    calls,
    run: async (_cwd: string, args: readonly string[]): Promise<string> => {
      const line = args.join(' ');
      calls.push(line);
      const rule = rules.find((r) => line.startsWith(r.when));
      if (rule?.fail !== undefined) {
        throw new Error(rule.fail);
      }
      return rule?.out ?? '';
    },
    locate: async () => null,
    commitPaths: async () => undefined,
    push: async () => undefined,
  };
  return git;
}

/** No upstream on `main`, the branch is behind main: the merge decides. */
const BEHIND = [
  { when: 'status --porcelain', out: '' },
  { when: 'config --get', fail: 'no such key' },
  { when: 'rev-parse --verify refs/heads/main', out: 'base0000000\n' },
  { when: 'merge-base --is-ancestor', fail: 'not an ancestor' },
];

const STAY_PUT = ['plan', 'prioritized'];

describe("the builder's sync-main at a run's green end (req-267)", () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, { baseRef: 'main', leaving: ['sync-main'], ...over });

  it('merges main into the branch after the gate, then the ticket moves on', async () => {
    const git = scriptedGit([...BEHIND, { when: 'merge --no-ff', out: '' }, { when: 'rev-parse --verify HEAD', out: 'merge000000\n' }]);
    const { sup, adapter, store } = harness(dirs.fleet, { ticketsGit: git });
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(git.calls.some((c) => c.startsWith('merge --no-ff --no-edit -m Merge main into t/T-0001 (sync-main, T-0001)'))).toBe(true);
    expect(store.of('release').map((c) => c.stage)).toEqual(['build']);
    expect((await runnerNotes(dirs.fleet, id)).join('\n')).toContain('sync-main: merged main');
  });

  it('a conflict is aborted and ends the run red with the conflict as its gate failure: the ticket stays with the builder', async () => {
    const git = scriptedGit([...BEHIND, { when: 'merge --no-ff', fail: 'CONFLICT (content): Merge conflict in a.txt' }, { when: 'diff --name-only --diff-filter=U', out: 'a.txt\n' }]);
    const { sup, adapter, store } = harness(dirs.fleet, { ticketsGit: git });
    const id = await startRun(sup, request(), 'ben');
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'failed');
    expect(git.calls).toContain('merge --abort');
    const info = sup.get(id)!;
    expect(info.gateResult).toBe('red');
    expect(info.gateFailure).toContain('conflicts in a.txt');
    expect(info.gateFailure).toContain('Merge conflict in a.txt');
    expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
    expect((await runnerNotes(dirs.fleet, id)).join('\n')).toContain('the ticket stays with ben');
  });

  it('main already in the branch merges nothing', async () => {
    const git = scriptedGit([...BEHIND.filter((r) => r.when !== 'merge-base --is-ancestor'), { when: 'merge-base --is-ancestor', out: '' }]);
    const { sup, adapter } = harness(dirs.fleet, { ticketsGit: git });
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(git.calls.some((c) => c.startsWith('merge '))).toBe(false);
  });

  it('a run without the leaving action never touches git at its end', async () => {
    const git = scriptedGit([]);
    const { sup, adapter } = harness(dirs.fleet, { ticketsGit: git });
    const id = await startRun(sup, request({ leaving: undefined }));
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(git.calls).toEqual([]);
  });
});

describe("You's commit as a machine run (req-267)", () => {
  const dirs = useTempDirs();
  const commit = (over: Partial<RunRequest> = {}): RunRequest =>
    runRequest(dirs.vault, { baseRef: 'main', machine: { action: 'commit', persona: 'you', policy: null }, ...over });
  const LOCAL = [
    { when: 'status --porcelain', out: '' },
    { when: 'rev-parse --verify refs/heads/t/T-0001', out: 'tip00000000\n' },
    { when: 'config --get', fail: 'no such key' },
    { when: 'rev-parse --verify refs/heads/main', out: 'base0000000\n' },
    { when: 'merge-base --is-ancestor', fail: 'not an ancestor' },
    { when: 'worktree list --porcelain', out: 'worktree W:/kt\nHEAD base0000000\ndetached\n' },
    { when: 'worktree remove', fail: 'not a working tree' },
  ];

  it('claims, merges without a worker, and ends done; the card says committing while it runs', async () => {
    const git = scriptedGit([...LOCAL, { when: 'merge --no-ff', out: '' }, { when: 'rev-parse --verify HEAD', out: 'merge000000\n' }]);
    const { sup, adapter, store } = harness(dirs.fleet, { ticketsGit: git });
    const outcome = await sup.start(commit());
    expect(outcome.ok).toBe(true);
    const id = outcome.ok ? outcome.run.id : '';
    expect(outcome.ok ? outcome.run.persona : null).toBe('you');
    await settled(sup, id, 'done');
    expect(adapter.handles).toHaveLength(0);
    expect(store.of('claim')).toHaveLength(1);
    expect(git.calls).toContain('worktree add --detach W:/fleet-worktrees/T-0001-commit base0000000');
    expect(git.calls).toContain('update-ref refs/heads/main merge000000 base0000000');
    expect(sup.get(id)?.gateResult).toBe('green');
    expect((await runnerNotes(dirs.fleet, id)).join('\n')).toContain('commit: merged into main');
  });

  it('req-185: after the landed merge the ticket\'s worktree goes with real git and the run says so; the branch stays', async () => {
    const worktree = path.join(dirs.vault, 'wt-T-0001');
    await fsp.mkdir(worktree);
    const git = scriptedGit([{ when: `worktree remove ${worktree}`, out: '' }, ...LOCAL, { when: 'merge --no-ff', out: '' }, { when: 'rev-parse --verify HEAD', out: 'merge000000\n' }]);
    const { sup } = harness(dirs.fleet, { ticketsGit: git });
    const outcome = await sup.start(commit({ worktreePath: worktree }));
    const id = outcome.ok ? outcome.run.id : '';
    await settled(sup, id, 'done');
    expect(git.calls).toContain(`worktree remove ${worktree}`);
    expect(git.calls.some((c) => c.startsWith('branch -D') || c.startsWith('branch -d'))).toBe(false);
    expect((await runnerNotes(dirs.fleet, id)).join('\n')).toContain(`worktree removed: ${worktree} (the branch t/T-0001 stays)`);
  });

  it('req-185: a worktree git refuses to remove is kept and named on the run', async () => {
    const worktree = path.join(dirs.vault, 'wt-T-0001');
    await fsp.mkdir(worktree);
    const git = scriptedGit([{ when: `worktree remove ${worktree}`, fail: 'locked working tree' }, ...LOCAL, { when: 'merge --no-ff', out: '' }, { when: 'rev-parse --verify HEAD', out: 'merge000000\n' }]);
    const { sup } = harness(dirs.fleet, { ticketsGit: git });
    const outcome = await sup.start(commit({ worktreePath: worktree }));
    const id = outcome.ok ? outcome.run.id : '';
    await settled(sup, id, 'done');
    expect(sup.get(id)?.gateResult).toBe('green');
    expect((await runnerNotes(dirs.fleet, id)).join('\n')).toContain(`worktree kept: ${worktree} — locked working tree`);
  });

  it('a conflict ends red with the reason; nothing moves the branch', async () => {
    const git = scriptedGit([...LOCAL, { when: 'merge --no-ff', fail: 'CONFLICT (content): Merge conflict in a.txt' }, { when: 'diff --name-only --diff-filter=U', out: 'a.txt\n' }]);
    const { sup, store } = harness(dirs.fleet, { ticketsGit: git });
    const outcome = await sup.start(commit());
    const id = outcome.ok ? outcome.run.id : '';
    await settled(sup, id, 'failed');
    expect(git.calls.some((c) => c.startsWith('update-ref'))).toBe(false);
    expect(sup.get(id)?.gateFailure).toContain('conflicts in a.txt');
    expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
  });

  it('a protected branch blocks for the owner', async () => {
    const git = scriptedGit(LOCAL);
    const { sup } = harness(dirs.fleet, { ticketsGit: git });
    const outcome = await sup.start(commit({ machine: { action: 'commit', persona: 'you', policy: 'pull request' } }));
    const id = outcome.ok ? outcome.run.id : '';
    await settled(sup, id, 'done');
    expect(sup.get(id)?.blocked).toContain('the policy merge awaits the owner');
  });

  it('refuses a second run on the ticket while one lives', async () => {
    const git = scriptedGit(LOCAL);
    const { sup } = harness(dirs.fleet, { ticketsGit: git });
    await startRun(sup, runRequest(dirs.vault));
    const outcome = await sup.start(commit());
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('already has a live run') });
  });
});
