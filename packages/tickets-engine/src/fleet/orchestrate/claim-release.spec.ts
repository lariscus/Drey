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

  describe('a lifecycle store (req-265: inbox prioritized active running done, claim running)', () => {
    const lifecycleSetup = (): Harness => {
      const store = new FakeTicketStore();
      store.stages = ['inbox', 'prioritized', 'active', 'running', 'done'];
      store.claimStage = 'running';
      store.stage = 'active';
      store.text = '---\nid: t-1\nstage: active\nrev: 4\nx-at: 3\n---\n\n## Description\n\nx\n\n## Log\n\n- start\n';
      return harness(dirs.fleet, {}, store);
    };

    it('req-257: a chain run hands on by its cursor — x-at in the in-claim put, then ONE release into active', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 6 } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.of('put')).toHaveLength(1);
      expect(t.store.text).toMatch(/^x-at: 4$/m);
      expect(t.store.of('comment')[0]?.text).toContain('handed over at position 3 of 6');
    });

    it('req-257: a send-back to an earlier position moves the cursor there, marks x-sent-back and writes the invalidation — no gate', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurnSaying(t.adapter.handles[0]!, 'The plan misses the migration.\nSEND-BACK: 2 the plan misses the migration step');
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.text).toMatch(/^x-at: 2$/m);
      expect(t.store.text).toMatch(/^x-sent-back: 3>2$/m);
      expect(t.store.of('comment')[0]?.text).toContain('sent back 3>2 — from 3 (ben) to 2 (paul): the plan misses the migration step; positions 2–4 run again');
    });

    it('req-257: a second send-back does not move the cursor — the ticket waits for the owner with both', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], sentBack: { from: 4, to: 3 } } }));
      endTurnSaying(t.adapter.handles[0]!, 'SEND-BACK: 1 start over');
      await settled(t.sup, id, 'done');
      expect(t.store.text).not.toMatch(/^x-at:/m);
      expect(t.store.text).toMatch(/^x-awaiting: you$/m);
      expect(t.store.of('comment')[0]?.text).toMatch(/^needs-decision: \[second-send-back\] a second send-back from position 3: start over/);
    });

    it('req-257: a send-back that names no earlier position is a red gate with the reason', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurnSaying(t.adapter.handles[0]!, 'SEND-BACK: 4 later');
      await settled(t.sup, id, 'failed');
      expect(t.sup.get(id)?.gateFailure).toBe('send-back to position 4 is not an earlier position of this chain (1–2)');
      expect(t.store.text).not.toMatch(/^x-sent-back:/m);
    });

    describe("req-78: a red gate whose entry names on-red sends the ticket back, and the target's green end returns", () => {
      const ENTRIES = ['paul', 'ben', 'ralf', 'tessa(on-red paul)', 'you'];
      const redSetup = (): Harness => {
        const t = lifecycleSetup();
        return { ...t, ...harness(dirs.fleet, { execShell: async () => Promise.reject(new Error('exit 1\nTests failed: 2')) }, t.store) };
      };

      it('the red gate at position 4 moves the cursor to Paul, records the return and the count, in one release — the one send-back stays unused', async () => {
        const t = redSetup();
        const id = await startRun(t.sup, request({ cursor: { at: 4, length: 5, entries: ENTRIES, maxRed: 3 } }));
        endTurn(t.adapter.handles[0]!);
        await settled(t.sup, id, 'failed');
        expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
        expect(t.store.text).toMatch(/^x-at: 1$/m);
        expect(t.store.text).toMatch(/^x-return-to: 4$/m);
        expect(t.store.text).toMatch(/^x-red-backs: 1$/m);
        expect(t.store.text).not.toMatch(/^x-sent-back:/m);
        expect(t.store.of('comment')[0]?.text).toContain('red gate at position 4 (tessa) — sent back to 1 (paul) (red 1 of 2); returns to position 4 when position 1 is through');
        expect(t.sup.get(id)?.redBackTo).toBe(1);
      });

      it('past the bound the red gate stays with its persona, as before', async () => {
        const t = redSetup();
        const id = await startRun(t.sup, request({ cursor: { at: 4, length: 5, entries: ENTRIES, redBacks: 2, maxRed: 3 } }));
        endTurn(t.adapter.handles[0]!);
        await settled(t.sup, id, 'failed');
        expect(t.store.text).not.toMatch(/^x-at:/m);
        expect(t.store.of('comment')[0]?.text).toMatch(/^failed: /);
        expect(t.sup.get(id)?.redBackTo).toBeUndefined();
      });

      it("the target's green end goes straight back to the position that went red, keeping the count", async () => {
        const t = lifecycleSetup();
        t.store.text = t.store.text.replace('x-at: 3', 'x-at: 1\nx-return-to: 4\nx-red-backs: 1');
        const id = await startRun(t.sup, request({ cursor: { at: 1, length: 5, entries: ENTRIES, returnTo: 4, redBacks: 1 } }));
        endTurn(t.adapter.handles[0]!);
        await settled(t.sup, id, 'done');
        expect(t.store.text).toMatch(/^x-at: 4$/m);
        expect(t.store.text).not.toMatch(/^x-return-to:/m);
        expect(t.store.text).toMatch(/^x-red-backs: 1$/m);
        expect(t.store.of('comment')[0]?.text).toContain('back to position 4 of 5, whose red gate sent it here');
      });

      it('a green end that is no return ends the loop and its count', async () => {
        const t = lifecycleSetup();
        t.store.text = t.store.text.replace('x-at: 3', 'x-at: 4\nx-red-backs: 1');
        const id = await startRun(t.sup, request({ cursor: { at: 4, length: 5, entries: ENTRIES, redBacks: 1 } }));
        endTurn(t.adapter.handles[0]!);
        await settled(t.sup, id, 'done');
        expect(t.store.text).toMatch(/^x-at: 5$/m);
        expect(t.store.text).not.toMatch(/^x-red-backs:/m);
      });

      it("a persona send-back drops a pending return — it invalidates everything from its target on", async () => {
        const t = lifecycleSetup();
        t.store.text = t.store.text.replace('x-at: 3', 'x-at: 2\nx-return-to: 4');
        const id = await startRun(t.sup, request({ cursor: { at: 2, length: 5, entries: ENTRIES, returnTo: 4 } }));
        endTurnSaying(t.adapter.handles[0]!, 'SEND-BACK: 1 the plan is wrong');
        await settled(t.sup, id, 'done');
        expect(t.store.text).toMatch(/^x-at: 1$/m);
        expect(t.store.text).not.toMatch(/^x-return-to:/m);
      });
    });

    it("req-257: a plan run's ### Chain becomes the ticket's chain at its green end, when the guard holds", async () => {
      const t = lifecycleSetup();
      t.store.text = t.store.text.replace('## Log', '## Plan\n\n### Chain\n\npaul:shape; paul; ben; ralf; you\n\n## Log');
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.text).toMatch(/^x-chain: paul:shape;paul;ben;ralf;you$/m);
      expect(t.store.text).toMatch(/^x-at: 4$/m);
      expect(t.store.of('comment')[0]?.text).toContain("the plan's ### Chain is the ticket's chain now");
    });

    it("req-257: a plan's chain that changes a past position is not applied, and the hand-on says why", async () => {
      const t = lifecycleSetup();
      t.store.text = t.store.text.replace('## Log', '## Plan\n\n### Chain\n\nralf; ben; you\n\n## Log');
      const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'], crew: { personas: ['paul', 'ben', 'ralf', 'you'], modeless: ['you'] } } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.text).not.toMatch(/^x-chain:/m);
      expect(t.store.of('comment')[0]?.text).toContain("the plan's ### Chain was not applied");
    });

    it('req-257: past the last entry the cursor stands one beyond it — the engine moves the ticket to done', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request({ cursor: { at: 6, length: 6 } }));
      endTurn(t.adapter.handles[0]!);
      await settled(t.sup, id, 'done');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.text).toMatch(/^x-at: 7$/m);
      expect(t.store.of('comment')[0]?.text).toContain('the chain is through');
    });

    it('a failed run hands the ticket back to active in one release - no retreat, no write-back', async () => {
      const t = lifecycleSetup();
      const id = await startRun(t.sup, request());
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
      expect(t.store.of('put').filter((c) => c.put?.expectedRev !== undefined)).toEqual([]);
      expect(t.store.text).toContain('x-at: 3'); // the cursor is untouched
    });

    it('a takeover of a ticket left in running (an expired lease) also ends in active', async () => {
      const t = lifecycleSetup();
      t.store.stage = 'running';
      const id = await startRun(t.sup, request());
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
    });

    it('a run started from an edge column (inbox) that moves nothing goes back there', async () => {
      const t = lifecycleSetup();
      t.store.stage = 'inbox';
      const id = await startRun(t.sup, request());
      t.adapter.handles[0]!.fail(1);
      await settled(t.sup, id, 'failed');
      expect(t.store.of('release').map((c) => c.stage)).toEqual(['inbox']);
    });
  });

  it('park = the park stage plus a comment; without a park stage the ticket keeps its own', async () => {
    const withStage = setup();
    const id = await startRun(withStage.sup, request({ dk: { ...DK_TARGET, parkStage: 'inbox' } }));
    endTurn(withStage.adapter.handles[0]!, 'BLOCKED: waits for the owner');
    await settled(withStage.sup, id, 'done');
    expect(withStage.store.of('release')[0]?.stage).toBe('inbox');
    expect(withStage.store.of('comment')[0]?.text).toMatch(/^blocked: /);

    const without = setup();
    const id2 = await startRun(without.sup, request());
    endTurn(without.adapter.handles[0]!, 'BLOCKED: waits for the owner');
    await settled(without.sup, id2, 'done');
    expect(without.store.of('release')[0]?.stage).toBe('prioritized');
  });

  it("a stage the store does not have falls back to the ticket's own stage", async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ dk: { ...DK_TARGET, parkStage: 'blocked' } }));
    endTurn(t.adapter.handles[0]!, 'BLOCKED: waits for the owner');
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
