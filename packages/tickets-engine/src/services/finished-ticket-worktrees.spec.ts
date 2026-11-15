import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoRef, TicketCard } from '../contracts/tickets';
import { FinishedWorktrees, type FinishedTarget, type RemovalOutcome } from '../fleet/worktrees/finished-worktrees';
import { finishedTargetsOf, removeDoneWorktrees } from './finished-ticket-worktrees';

const VAULT = path.resolve('/tickets');
const repo = (name: string, over: Partial<RepoRef> = {}): RepoRef =>
  ({ name, url: `https://example.test/${name}.git`, branch: 'main', policy: null, path: path.resolve(`/${name}`), worker: null, worktrees: null, launch: null, instructions: null, ...over }) as RepoRef;
const card = (meta: { repo: string | null; repos?: readonly string[] }): TicketCard =>
  ({ id: 'T-0007', path: 'tickets/done/T-0007.md', phase: 'done', meta: { repo: meta.repo, repos: meta.repos ?? [], branch: null } }) as unknown as TicketCard;

function finished(outcomes: Readonly<Record<string, RemovalOutcome>>): { finished: FinishedWorktrees; asked: FinishedTarget[] } {
  const asked: FinishedTarget[] = [];
  return {
    asked,
    finished: new FinishedWorktrees({
      exists: async (p) => p in outcomes,
      remove: async (t) => {
        asked.push(t);
        return outcomes[t.worktreePath]!;
      },
    }),
  };
}

describe("the engine's Done moves leave no worktree behind (req-185)", () => {
  const repos = [repo('drey', { link: ['node_modules'] }), repo('site'), repo('nolocal', { path: null })];

  it("names the ticket's repo first, then its further repos; a repo without a local path has none", () => {
    const targets = finishedTargetsOf(VAULT, repos, card({ repo: 'drey', repos: ['drey', 'site', 'nolocal'] }));
    expect(targets.map((t) => t.repoPath)).toEqual([path.resolve('/drey'), path.resolve('/site')]);
    expect(targets[0]!.links).toEqual(['node_modules']);
    expect(targets[0]!.worktreePath).toBe(path.join(VAULT, '_worktrees', 'T-0007'));
    expect(finishedTargetsOf(VAULT, repos, card({ repo: null }))).toEqual([]);
  });

  it('removes them and warns about nothing when all went', async () => {
    const wt = path.join(VAULT, '_worktrees', 'T-0007');
    const fake = finished({ [wt]: { ok: true } });
    await expect(removeDoneWorktrees({ ...fake, vaultPath: VAULT, repos, card: card({ repo: 'drey' }), liveRun: false })).resolves.toBeNull();
    expect(fake.asked.map((t) => t.worktreePath)).toEqual([wt]);
  });

  it('a dirty worktree is kept and becomes the warning', async () => {
    const wt = path.join(VAULT, '_worktrees', 'T-0007');
    const fake = finished({ [wt]: { ok: false, dirty: true } });
    await expect(removeDoneWorktrees({ ...fake, vaultPath: VAULT, repos, card: card({ repo: 'drey' }), liveRun: false })).resolves.toBe(`worktree kept: ${wt} — it has uncommitted changes`);
  });

  it('a live run on the ticket keeps every worktree untouched', async () => {
    const fake = finished({});
    await expect(removeDoneWorktrees({ ...fake, vaultPath: VAULT, repos, card: card({ repo: 'drey' }), liveRun: true })).resolves.toBe('A run is live on the ticket — the worktree was kept');
    expect(fake.asked).toEqual([]);
  });
});
