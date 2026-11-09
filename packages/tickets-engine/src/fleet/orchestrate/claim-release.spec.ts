import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TicketStoreError } from '../../ports/ticket-store';
import type { RunSupervisorDeps } from '../compose-supervisor';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from '../store/ticket-store.fake';
import { settled, waitFor } from './run-spec-support';
import { buildRequest, DK_TARGET, endTurn, harness, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

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

  it('R-31: a failed run that sat in the claim stage ends where it sat - release back, then put --claim writes the stage back', async () => {
    const t = setup();
    t.store.stage = 'build';
    const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null }));
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['build', 'prioritized']);
    const puts = t.store.of('put');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.put).toMatchObject({ expectedRev: 4 }); // the ticket is nobody's now: a normal put --claim --if-version
    expect(puts[0]?.put?.holdsClaim).not.toBe(true);
    expect(t.store.stage).toBe('build');
  });

  it('a retreat whose write-back fails leaves the ticket in the retreat stage (and the run still settles)', async () => {
    const t = setup();
    t.store.stage = 'build';
    t.store.failNext('put', new TicketStoreError('invalid', 'put refused', 14));
    const id = await startRun(t.sup, request({ nextPhase: null, nextPhaseDir: null }));
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
    expect(t.store.stage).toBe('prioritized');
    expect(t.logs.join('\n')).toContain('stays in its retreat stage');
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
