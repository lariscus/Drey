import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LedgerWrite } from '../../core/ledger';
import { ChainHarness, ONE, STORE } from './chain-harness.fake';

/**
 * req-257: the runner on persona chains — on a lifecycle store the holder
 * (the chain's entry at the cursor) is who runs, through the real
 * composition over the fake store: the cursor rides the request, a `:shape`
 * entry, a You entry and a missing persona start nothing (each says why),
 * a persona's own pool caps it, finishing beats starting.
 */

let h: ChainHarness;
const LIFECYCLE = { ...STORE, lifecycle: true };
const STANDARD = ['paul:shape', 'paul', 'ben', 'you'];

describe('the holder dispatch on a lifecycle store (req-257)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
    await h.writePersona('paul', { worker: 'opencode', model: 'glm', role: 'planner' });
    await h.writePersona('ben', { worker: 'opencode', model: 'opus' });
    await h.writeHuman();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it("dispatches the holder's run with its cursor — no next column, the persona of the entry", async () => {
    h.io.seed('T-0300', 'active', { chain: STANDARD, extensions: { at: '3' } });
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ store: LIFECYCLE }));
    await orch.setMaster('run');

    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0300']);
    const request = fleet.records[0]!.request;
    expect(request.cursor).toMatchObject({ at: 3, length: 4, entries: STANDARD, crew: { personas: expect.arrayContaining(['paul', 'ben', 'you']) as unknown } });
    expect(request.instruction).toContain('3. ben — you, now');
    expect(request.instruction).toContain('SEND-BACK: <position>');
    expect(request.nextPhase).toBeNull();
    expect(request.dk?.lifecycle).toBe(true);
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'ben' });
  });

  it('a shape entry, a You entry and an entry naming no persona start nothing, each saying why', async () => {
    h.io.seed('T-0301', 'active', { chain: STANDARD, extensions: { at: '1' } });
    h.io.seed('T-0302', 'active', { chain: STANDARD, extensions: { at: '4' } });
    h.io.seed('T-0303', 'active', { chain: ['paul', 'bob', 'you'], extensions: { at: '2' } });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config({ store: LIFECYCLE }));
    await orch.setMaster('run');

    expect(fleet.records).toEqual([]);
    expect(logs.join('\n')).toContain('T-0301 waits at position 1 of 4 for the Shape chat with paul');
    expect(logs.join('\n')).toContain('T-0303 stands at You: no persona for position 2 ("bob" is not in the crew)');
    expect(logs.join('\n')).not.toContain('T-0302');
  });

  it("caps a persona at its own pool (parallel) and says the ticket waits for it", async () => {
    await h.write('tickets/_meta/personas/ben/persona.md', ['---', 'title: ben', 'role: builder', 'worker: opencode', 'models:', '  default: opus', '  pool: [opus]', 'parallel: 1', '---', ''].join('\n'));
    h.io.seed('T-0310', 'active', { chain: STANDARD, extensions: { at: '3' } });
    h.io.seed('T-0311', 'active', { chain: STANDARD, extensions: { at: '3' } });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config({ store: LIFECYCLE }));
    await orch.setMaster('run');

    expect(fleet.records).toHaveLength(1);
    expect(logs.join('\n')).toMatch(/waits for ben — the persona runs its maximum/);
    // req-271: the chain status names the waiting ticket and its persona — the card's `waits for Ben`
    const waiting = fleet.records[0]!.request.ticketId === 'T-0310' ? 'T-0311' : 'T-0310';
    expect(orch.status().personaWaits).toEqual({ [waiting]: 'ben' });
  });

  it('finishing beats starting: the later position takes the one slot', async () => {
    h.io.seed('T-0320', 'active', { chain: STANDARD, rank: 1, extensions: { at: '2' } });
    h.io.seed('T-0321', 'active', { chain: STANDARD, rank: 2, extensions: { at: '3' } });
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ store: LIFECYCLE, pools: ONE }));
    await orch.setMaster('run');

    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0321']);
  });

  it('a held persona starts nothing — the owner paused it', async () => {
    h.io.seed('T-0330', 'active', { chain: STANDARD, extensions: { at: '3' } });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config({ store: LIFECYCLE }));
    await orch.setPersonaPaused('ben', true);
    await orch.setMaster('run');

    expect(fleet.records).toEqual([]);
    expect(logs.join('\n')).toContain('persona "ben" is paused');
  });

  it('req-274: each pass records the holders as hold lines — with the Autopilot off too — and chain.json keeps them', async () => {
    h.io.seed('T-0330', 'active', { chain: STANDARD, extensions: { at: '3' } });
    h.io.seed('T-0331', 'active', { chain: ['paul', 'bob'], extensions: { at: '2' } });
    h.io.seed('T-0332', 'inbox', { chain: STANDARD });
    const lines: LedgerWrite[] = [];
    const { orch } = h.build({ events: { ledger: (write) => lines.push(write) } });
    await orch.configure(h.config({ store: LIFECYCLE }));

    expect(lines.filter((l) => l.kind === 'hold')).toEqual([
      { kind: 'hold', ticket: 'T-0330', persona: 'ben', position: 3, length: 4 },
      { kind: 'hold', ticket: 'T-0331', persona: 'you', position: 2, length: 2 },
    ]);
    expect((await h.chainFile())['holds']).toEqual({ 'T-0330': { persona: 'ben', position: 3, length: 4 }, 'T-0331': { persona: 'you', position: 2, length: 2 } });
  });
});
