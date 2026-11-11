import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TicketStoreError } from '../../ports/ticket-store';
import type { RunRequest } from '../protocol';
import { settled } from './run-spec-support';
import { harness, orderedHarness, runnerNotes, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';
import { gitRecorder } from './tickets-git.fake';

describe('RunStarter — the rules, the claim first, then the worktree and the worker', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const dialog = (): RunRequest => request({ acceptance: [], gate: 'structural', nextPhase: null, nextPhaseDir: null, interactive: 'plan' });

  it('refuses a second live run for the ticket', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    await sup.start(request());
    const second = await sup.start(request());
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toContain('already has a live run');
    expect(adapter.handles).toHaveLength(1);
  });

  it('validates the deterministic branch and the machine gate before spawning', async () => {
    const { sup } = harness(dirs.fleet);
    const wrongBranch = await sup.start(request({ branch: 'feature/x' }));
    expect(wrongBranch.ok).toBe(false);
    const noGate = await sup.start(request({ acceptance: [] }));
    expect(noGate.ok).toBe(false);
    expect(!noGate.ok && noGate.error).toContain('carries no gate commands');
    const wrongPath = await sup.start(request({ ticketRelPath: 'tickets/build/T-0001.md' }));
    expect(wrongPath.ok).toBe(false);
    expect(!wrongPath.ok && wrongPath.error).toContain('does not match id and phase');
    // The first worker column may take the ticket anyway: its run gates
    // structurally (the plan writes the criteria).
    const structural = await sup.start(request({ acceptance: [], gate: 'structural' }));
    expect(structural.ok).toBe(true);
  });

  it('a start without a dricket store target is refused, and nothing is claimed or spawned (req-176)', async () => {
    const { sup, adapter, store } = harness(dirs.fleet);
    const { dk: _none, ...legacy } = request();
    const outcome = await sup.start(legacy);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('names no dricket store') });
    expect(adapter.starts).toHaveLength(0);
    expect(store.calls).toEqual([]);
  });

  it('accepts a numbered phase directory in the ticket path (T-0041)', async () => {
    const { sup } = harness(dirs.fleet);
    const started = await sup.start(request({ ticketRelPath: 'tickets/30-plan/T-0001.md' }));
    expect(started.ok).toBe(true);
  });

  describe('every start says who asks (D-41)', () => {
    it('a start with no origin is refused, and nothing spawns', async () => {
      const { sup, adapter } = harness(dirs.fleet);
      const { origin: _none, ...nameless } = request();
      const outcome = await sup.start(nameless);
      expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('names no origin') });
      expect(adapter.starts).toHaveLength(0);
    });

    it('the origin lands in the runner log and on the record', async () => {
      const { sup, logs } = harness(dirs.fleet);
      const id = await startRun(sup, request({ origin: 'drey:run-dialog' }));
      expect(logs).toContain(`run ${id} (T-0001): asked by drey:run-dialog`);
      expect(sup.get(id)?.origin).toBe('drey:run-dialog');
    });
  });

  describe('the claim comes first (E14-5)', () => {
    it('claims BEFORE the worktree and the worker, as a per-run owner', async () => {
      const t = orderedHarness(dirs.fleet);
      const id = await startRun(t.sup, request());
      expect(t.order.slice(0, 3)).toEqual(['claim', 'worktree', 'spawn']);
      expect(t.store.of('claim')[0]?.actor).toMatch(/^agent-r-.*@/);
      expect(t.store.of('claim')[0]?.actor).toContain(id.toLowerCase());
      t.adapter.handles[0]!.fail(null);
      await settled(t.sup, id, 'failed');
    });

    it('a ticket someone else holds refuses the start: no worktree, no worker', async () => {
      const t = orderedHarness(dirs.fleet);
      t.store.failNext('claim', new TicketStoreError('claimed', 'ticket t-1 is claimed by henrik (lease until 2026-10-18T00:00:00Z)', 11));
      const outcome = await t.sup.start(request());
      expect(outcome).toMatchObject({ ok: false });
      expect(!outcome.ok && outcome.error).toContain('claimed by henrik');
      expect(t.order).toEqual(['claim']);
      expect(t.adapter.handles).toHaveLength(0);
    });
  });

  describe('the interactive dialog (req-65, req-75)', () => {
    it('an interactive dialog starts held, takes the long claim, and ends without gate or move (req-65)', async () => {
      const { sup, adapter, gate, store } = harness(dirs.fleet);
      const started = await sup.start(dialog());
      expect(started.ok).toBe(true);
      const info = started.ok ? started.run : null;
      // Held from turn one — before the worker says anything.
      expect(adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
      expect(info?.held).toBe(true);
      expect(info?.interactive).toBe('plan');
      expect(info?.state).toBe('running');
      // req-176: the dialog's reservation is the long (L) claim on the store (it was the ticket's `interactive:` field).
      expect(store.of('claim')[0]?.size).toBe('L');

      // The worker ends its turn without a result — a dialog turn, not a
      // claim: the run still ends done, and nothing gates or moves.
      adapter.handles[0]!.fail(0);
      await settled(sup, info!.id, 'done');
      expect(gate).toEqual([]);
      expect(store.of('release').map((c) => c.stage)).not.toContain('build');
      expect(store.stage).toBe('prioritized'); // no move: back where it sat is refused (R-31), so it retreats - a lifecycle store releases to active (req-265)
      expect((await runnerNotes(dirs.fleet, info!.id)).some((line) => line.startsWith('interactive dialog ended'))).toBe(true);
    });

    it('an interactive dialog spawns quiet — no brief delivered, the worker stands held (req-75)', async () => {
      const { sup, adapter } = harness(dirs.fleet);
      const id = await startRun(sup, dialog());
      // Nothing runs until the owner asks: the adapter delivers no first
      // prompt, and the record says the brief still rides ahead.
      expect(adapter.starts[0]!.holdAtSpawn).toBe(true);
      expect(adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
      expect(sup.get(id)?.quietStart).toBe(true);
      expect(sup.get(id)?.held).toBe(true);
    });
  });

  describe('the worktree preparation (T-0044)', () => {
    it('reuses an existing registered worktree for a re-run', async () => {
      const git = gitRecorder();
      const { sup } = harness(dirs.fleet, { prepareWorktree: undefined, ticketsGit: git.ticketsGit });
      // The path comes from the request (T-0044) — the runner never derives one.
      const wt = request().worktreePath.replace(/\\/g, '/');
      git.worktreeList = [`worktree ${wt}`, 'branch refs/heads/t/T-0001', '', `worktree ${path.join(dirs.fleet, 'worktrees', 'kt-other')}`, 'branch refs/heads/other', ''].join('\n');

      // `git worktree add` throws on the existing path; the registration
      // for the same branch makes the start succeed anyway.
      const started = await sup.start(request());
      expect(started.ok).toBe(true);
    });

    it('refuses a start whose worktree path is registered for another branch', async () => {
      const git = gitRecorder();
      const { sup } = harness(dirs.fleet, { prepareWorktree: undefined, ticketsGit: git.ticketsGit });
      const wt = request().worktreePath.replace(/\\/g, '/');
      git.worktreeList = [`worktree ${wt}`, 'branch refs/heads/other', ''].join('\n');

      const refused = await sup.start(request());
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error).toContain('worktree failed');
    });
  });
});
