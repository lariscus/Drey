import { promises as fsp } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunRequest } from '../protocol';
import { ticketCopyPathFor } from '../worktrees/worktree-home';
import { settled } from './run-spec-support';
import { endTurn, harness, runnerNotes, runRequest, startRun, streamText, useTempDirs } from './supervisor-harness.fake';

/** Scout runs (E8, concept §5.6): no worktree, no gate, no move — the report chapter is the deliverable. */
describe('RunCompletion — scout runs', () => {
  const dirs = useTempDirs();
  const scoutRequest = (over: Partial<RunRequest> = {}): RunRequest =>
    runRequest(dirs.vault, {
      form: 'scout',
      acceptance: [],
      gate: 'none',
      worktreePath: 'W:/kt', // the read ground — the repo checkout itself
      instruction: 'Scout it.',
      ...over,
    });
  const notesSay = async (runId: string, text: string): Promise<boolean> => (await runnerNotes(dirs.fleet, runId)).some((line) => line.includes(text));

  it('a scout run starts without a worktree: no preparation, the record and the opening note say scout', async () => {
    const prepare = vi.fn(async () => ({ outcome: 'created' as const, sessionInvalidated: false, movedTo: null }));
    const { sup, adapter, store } = harness(dirs.fleet, { prepareWorktree: prepare });
    const started = await sup.start(scoutRequest());
    expect(started.ok).toBe(true);
    const info = started.ok ? started.run : null;
    expect(prepare).not.toHaveBeenCalled(); // exploration only — no worktree
    expect(info?.form).toBe('scout');
    expect(info?.worktree).toBeUndefined();
    expect(info?.worktreePath).toBe('W:/kt'); // the read ground
    expect(adapter.starts[0]!.cwd).toBe('W:/kt'); // the worker spawns there
    // The ticket carries the live run: the run's claim.
    expect(store.of('claim')[0]?.actor).toContain(info!.id.toLowerCase());
    // The stream's opening note frames the run and names the read ground.
    expect(await streamText(dirs.fleet, info!.id)).toContain('scout run, read ground W:/kt (no worktree, no gate, no move)');
  });

  it('a finished scout run ends done: no gate runs, nothing moves, the report line names the card', async () => {
    const { sup, adapter, gate, store } = harness(dirs.fleet);
    const id = await startRun(sup, scoutRequest());

    // The worker wrote its report into its copy of the ticket.
    const copy = ticketCopyPathFor(dirs.vault, 'T-0001');
    const report =
      '## Report\n\nWritten on 2026-10-17T12:00:00Z by pia.\n\n### Summary\n\nOnly SQLite is wired in.\n\n### Decisions\n\n- [ ] D1: Which storage should back the index? — Recommendation: SQLite\n\n## Log';
    await fsp.writeFile(copy, (await fsp.readFile(copy, 'utf8')).replace('## Log', report), 'utf8');

    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');

    expect(gate).toEqual([]); // the machine gate never ran
    expect(store.of('release').map((c) => c.stage)).not.toContain('build'); // no move
    expect(await notesSay(id, 'the ## Report chapter waits for the owner in Needs you')).toBe(true);
    // The report chapter itself survived the run's bookkeeping: it is in the store.
    expect(store.text).toContain('## Report');
    expect(store.text).toContain('Only SQLite is wired in.');
  });

  it('a scout run that ends without a report is still done — the note says nothing waits', async () => {
    const { sup, adapter, gate } = harness(dirs.fleet);
    const id = await startRun(sup, scoutRequest());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(gate).toEqual([]);
    expect(await notesSay(id, 'scout run finished (exit 0) without a ## Report chapter')).toBe(true);
  });

  it('a scout worker that ends without its turn fails like any run', async () => {
    const { sup, adapter, gate } = harness(dirs.fleet);
    const id = await startRun(sup, scoutRequest());
    adapter.handles[0]!.fail(1); // no result — the worker died mid-exploration
    await settled(sup, id, 'failed');
    expect(gate).toEqual([]); // still no gate
    expect(await notesSay(id, 'worker ended without finishing its turn')).toBe(true);
  });

  it('a blocked scout end stays put: done with the blocked reason, no report bookkeeping', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, scoutRequest());
    endTurn(adapter.handles[0]!, 'the index API needs an owner decision');
    await settled(sup, id, 'done');
    expect(sup.get(id)?.blocked).toBe('the index API needs an owner decision');
    expect(await notesSay(id, 'blocked — the index API needs an owner decision')).toBe(true);
    expect(await notesSay(id, '## Report chapter waits')).toBe(false);
  });
});
