import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TicketStoreError } from '../../ports/ticket-store';
import type { RunSupervisorDeps } from '../compose-supervisor';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from '../store/ticket-store.fake';
import { settled, waitFor } from './run-spec-support';
import { buildRequest, DK_TARGET, endTurn, endTurnSaying, harness, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

/**
 * E14-5: the run's hand-back of its ticket. The store is a scripted fake
 * (what `dk` answers is dk's business, specified in dricket); what must
 * hold here is the ORDER and the ABSENCE: the ticket is given up through
 * release (never a file write), with the Verlauf line inside the claim.
 */
describe('ClaimRelease — release is the one door', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => buildRequest(dirs.vault, over);
  const setup = (deps: Partial<RunSupervisorDeps> = {}): Harness => harness(dirs.fleet, deps, new FakeTicketStore());

  it('a green gate releases to the next phase with a comment - and writes no ticket file', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['commit']);
    expect(t.store.of('comment')[0]?.text).toContain('moving to commit');
    expect(t.store.of('comment')[0]?.text).toMatch(/^done: handed over on /); // E14-6: the keyed status verb leads
    expect(t.store.calls.map((c) => c.op)).not.toContain('extend');
    expect((await fsp.readdir(dirs.vault)).filter((name) => name !== '_worktrees' && name !== '_workcopy')).toEqual([]); // not a single ticket file or commit (D-30)
    expect(await fsp.readdir(path.join(dirs.vault, '_workcopy')).catch(() => [])).toEqual([]); // the working copy went with the run (req-183: _workcopy/)
    expect(t.timers.armed).toBeNull(); // the keep-alive ended with the release
  });

  it('a red gate gives the ticket back where it came from (release is the one door)', async () => {
    const t = setup({
      execShell: async () => {
        throw Object.assign(new Error('boom'), { stdout: 'red', stderr: '' });
      },
    });
    const id = await startRun(t.sup, request());
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'failed');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['prioritized']); // preStage
    expect(t.store.of('comment')).toHaveLength(1);
    expect(t.store.of('comment')[0]?.text).toMatch(/^failed: /);
  });

  it('a release that may not stay put retreats to the stage before the working one', async () => {
    const t = setup();
    t.store.stage = 'build'; // the ticket already sat in the claim stage
    const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null }));
    t.adapter.handles[0]!.fail(1); // no agent-done: the step fails
    await settled(t.sup, id, 'failed');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['build', 'prioritized']);
  });

  it('req-265: a store still on phase stages keeps the retreat but no longer writes the stage back (the R-31 write-back is gone)', async () => {
    const t = setup();
    t.store.stage = 'build';
    const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null }));
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['build', 'prioritized']);
    expect(t.store.of('put').filter((c) => c.put?.expectedRev !== undefined)).toEqual([]); // no put --claim after the release
    expect(t.store.stage).toBe('prioritized');
  });

  describe('a lifecycle store (req-265: inbox prioritized active running done, claim running)', () => {
    const LIFECYCLE_DK = { ...DK_TARGET, retreatStage: null, lifecycle: true };
    const lifecycleSetup = (): Harness => {
      const store = new FakeTicketStore();
      store.stages = ['inbox', 'prioritized', 'active', 'running', 'done'];
      store.claimStage = 'running';
      store.stage = 'active';
      store.text = '---\nid: t-1\nstage: active\nrev: 4\nx-phase: build\n---\n\n## Description\n\nx\n\n## Log\n\n- start\n';
      return harness(dirs.fleet, {}, store);
    };

    it('req-257: a chain run hands on by its cursor — x-at in the in-claim put, then ONE release into active', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 6 } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.of('put')).toHaveLength(1);
      expect(t.store.text).toMatch(/^x-at: 4$/m);
      expect(t.store.of('comment')[0]?.text).toContain('handed over at position 3 of 6');
    });

    it('req-257: a send-back to an earlier position moves the cursor there, marks x-sent-back and writes the invalidation — no gate', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurnSaying(t.adapter.handles[0]!, 'The plan misses the migration.\nSEND-BACK: 2 the plan misses the migration step');
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.text).toMatch(/^x-at: 2$/m);
      expect(t.store.text).toMatch(/^x-sent-back: 3>2$/m);
      expect(t.store.of('comment')[0]?.text).toContain('sent back 3>2 — from 3 (ben) to 2 (paul): the plan misses the migration step; positions 2–4 run again');
    });

    it('req-257: a second send-back does not move the cursor — the ticket waits for the owner with both', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], sentBack: { from: 4, to: 3 } } }));
      endTurnSaying(t.adapter.handles[0]!, 'SEND-BACK: 1 start over');
      await settled(t.sup, id, 'done');
      expect(t.store.text).not.toMatch(/^x-at:/m);
      expect(t.store.text).toMatch(/^x-awaiting: you$/m);
      expect(t.store.of('comment')[0]?.text).toMatch(/^needs-decision: \[second-send-back\] a second send-back from position 3: start over/);
    });

    it('req-257: a send-back that names no earlier position is a red gate with the reason', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurnSaying(t.adapter.handles[0]!, 'SEND-BACK: 4 later');
      await settled(t.sup, id, 'failed');
      expect(t.sup.get(id)?.gateFailure).toBe('send-back to position 4 is not an earlier position of this chain (1–2)');
      expect(t.store.text).not.toMatch(/^x-sent-back:/m);
    });

    it("req-257: a plan run's ### Chain becomes the ticket's chain at its green end, when the guard holds", async () => {
      const t = lifecycleSetup();
      t.store.text = t.store.text.replace('## Log', '## Plan\n\n### Chain\n\npaul:shape; paul; ben; ralf; you\n\n## Log');
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.text).toMatch(/^x-chain: paul:shape;paul;ben;ralf;you$/m);
      expect(t.store.text).toMatch(/^x-at: 4$/m);
      expect(t.store.of('comment')[0]?.text).toContain("the plan's ### Chain is the ticket's chain now");
    });

    it("req-257: a plan's chain that changes a past position is not applied, and the hand-on says why", async () => {
      const t = lifecycleSetup();
      t.store.text = t.store.text.replace('## Log', '## Plan\n\n### Chain\n\nralf; ben; you\n\n## Log');
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.text).not.toMatch(/^x-chain:/m);
      expect(t.store.of('comment')[0]?.text).toContain("the plan's ### Chain was not applied");
    });

    it('req-257: past the last entry the cursor stands one beyond it — the engine moves the ticket to done', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK, nextPhase: null, nextPhaseDir: null, cursor: { at: 6, length: 6 } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.text).toMatch(/^x-at: 7$/m);
      expect(t.store.of('comment')[0]?.text).toContain('the chain is through');
    });

    it('a green gate: the next column is the release, the pin goes (req-257), ONE release into active', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      const ops = t.store.calls.map((c) => c.op);
      expect(ops.indexOf('put')).toBeLessThan(ops.indexOf('release'));
      expect(t.store.of('put')).toHaveLength(1);
      expect(t.store.of('put')[0]?.put).toEqual({ holdsClaim: true, actor: expect.stringMatching(/^agent-r-/) });
      expect(t.store.text).not.toContain('x-phase:');
      expect(t.store.of('comment')[0]?.text).toContain('moving to commit');
    });

    it('a pin that cannot be written moves nothing: the ticket goes back to active in its old column', async () => {
      const t = lifecycleSetup();
      t.store.failNext('put', new TicketStoreError('invalid', 'put refused', 14));
      const id = await startRun(t.sup, request({ dk: LIFECYCLE_DK }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'failed'); // a move that could not be made fails the run, as a refused release does
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.text).toContain('x-phase: build'); // not moved to commit
      expect(t.store.of('comment').map((c) => c.text).join('\n')).not.toContain('moving to commit');
    });

    it('a failed run hands the ticket back to active in one release - no retreat, no write-back', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null, dk: LIFECYCLE_DK }));
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.of('put').filter((c) => c.put?.expectedRev !== undefined)).toEqual([]);
      expect(t.store.text).toContain('x-phase: build'); // the column is untouched
    });

    it('a takeover of a ticket left in running (an expired lease) also ends in active', async () => {
      const t = lifecycleSetup();
      t.store.stage = 'running';
      const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null, dk: LIFECYCLE_DK }));
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
    });

    it('a run started from an edge column (inbox) that moves nothing goes back there', async () => {
      const t = lifecycleSetup();
      t.store.stage = 'inbox';
      const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null, dk: LIFECYCLE_DK }));
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['inbox']);
    });
  });

  it('park = the park stage plus a comment; without a park stage the ticket keeps its own', async () => {
    const withStage = setup();
    const id = await startRun(withStage.sup, request({ nextPhase: null, nextPhaseDir: null, parkFor: 'owner', dk: { ...DK_TARGET, parkStage: 'inbox' } }));
    endTurn(withStage.adapter.handles[0]!);
    await settled(withStage.sup, id, 'done');
    expect(withStage.store.of('release')[0]?.stage).toBe('inbox');
    expect(withStage.store.of('comment')[0]?.text).toContain('parked for owner');

    const without = setup();
    const id2 = await startRun(without.sup, request({ nextPhase: null, nextPhaseDir: null, parkFor: 'owner' }));
    endTurn(without.adapter.handles[0]!);
    await settled(without.sup, id2, 'done');
    expect(without.store.of('release')[0]?.stage).toBe('prioritized');
  });

  it("a stage the store does not have falls back to the ticket's own stage", async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null, parkFor: 'owner', dk: { ...DK_TARGET, parkStage: 'blocked' } }));
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'done');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['blocked', 'prioritized']);
  });

  it('a worker that declares itself blocked releases the claim with its words as the comment', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    endTurn(t.adapter.handles[0]!, 'BLOCKED: needs the API key');
    await settled(t.sup, id, 'done');
    expect(t.store.of('comment')[0]?.text).toContain('needs the API key');
    expect(t.store.of('comment')[0]?.text).toMatch(/^blocked: \[run-[a-z0-9-]+\] BLOCKED: needs the API key/); // a closable key, the worker's words
    expect(t.store.of('release')).toHaveLength(1);
    expect(t.gate).toEqual([]); // no gate on a blocked end
  });

  describe('the Verlauf line inside the claim', () => {
    it('writes the Verlauf line INSIDE the claim: one put without --claim, before the release', async () => {
      const t = setup();
      const id = await startRun(t.sup, request());
      t.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:00Z', kind: 'usage', tokensIn: 1200, tokensOut: 300 });
      await waitFor(() => expect(t.sup.get(id)?.tokensIn).toBe(1200));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      const ops = t.store.calls.map((c) => c.op);
      const put = ops.indexOf('put');
      expect(put).toBeGreaterThan(-1);
      expect(put).toBeLessThan(ops.indexOf('release')); // inside the claim, before it is given up
      expect(t.store.of('put')[0]?.put).toEqual({ holdsClaim: true, actor: expect.stringMatching(/^agent-r-/) });
      expect(t.store.text).toContain('## Verlauf');
      expect(t.store.text).toContain('tokens');
      expect(t.store.of('put')).toHaveLength(1); // the settle wrote no second one
    });

    it('a run that consumed nothing writes no Verlauf line', async () => {
      const t = setup();
      const id = await startRun(t.sup, request());
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('put').filter((c) => c.put?.holdsClaim === true)).toHaveLength(0);
    });
  });
});
