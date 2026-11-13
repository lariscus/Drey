import { describe, expect, it } from 'vitest';
import type { ClassRequest, PoolGrantDecision, RouteRecord, RunRequest } from '../protocol';
import { RIG_NOW, RouteRig, windowWithQ } from './route-rig.fake';
import { slot } from './routing.fake';

const claudeA = slot({ id: 'claude-a', label: 'Claude A', sessions: 4 });
const claudeB = slot({ id: 'claude-b', label: 'Claude B', sessions: 4 });
const zai = slot({ id: 'zai', label: 'z.ai', provider: 'opencode' });
const kimi = slot({ id: 'kimi', label: 'Kimi', provider: 'kimi' });
const SLOTS = [claudeA, claudeB, zai, kimi];

const VISION = { input: ['text', 'image'], tools: true, context: 200_000 };
/** opus A only on Claude A; sonnet B on every Claude slot; glm B on z.ai (no image input); kimi C. */
const TABLE = [
  { model: 'opus', slot: 'claude-a', class: 'A', cost: 5, sessions: 1, ...VISION },
  { model: 'sonnet', provider: 'claude-code', class: 'B', cost: 1, sessions: 2, ...VISION },
  { model: 'glm', slot: 'zai', class: 'B', cost: 0.4, sessions: 3, input: ['text'], tools: true, context: 128_000 },
  { model: 'kimi-k2', provider: 'kimi', class: 'C', cost: 0.3, sessions: 2, input: ['text'] },
];
const POOL = [{ provider: null, model: 'opus' }, { provider: null, model: 'sonnet' }, { provider: null, model: 'glm' }, { provider: null, model: 'kimi-k2' }];

const ask = (over: Partial<ClassRequest> = {}): ClassRequest => ({
  ticket: 'T-0121',
  persona: 'ben',
  class: 'B',
  pool: POOL,
  provider: 'claude-code',
  contextTokens: null,
  ledger: { allowance: null, personaBudget: null, spendAboveAllowance: false },
  prefer: null,
  why: 'size M → B',
  stepUp: true,
  ...over,
});

async function rig(q: Readonly<Record<string, number>>, routing?: Record<string, unknown>): Promise<RouteRig> {
  const r = new RouteRig(SLOTS);
  await r.load({ models: TABLE, ...(routing !== undefined ? { routing } : {}) }, q);
  return r;
}

const granted = (decision: ReturnType<RouteRig['grant']['choose']>): PoolGrantDecision => {
  expect(decision.kind).toBe('grant');
  return decision as PoolGrantDecision;
};
const route = (decision: ReturnType<RouteRig['grant']['choose']>): RouteRecord => granted(decision).route!;

describe('surplus routing — filter, then the largest surplus within the class (req-178)', () => {
  it("the filter's reasons, then the choice: board 8a's line", async () => {
    const r = await rig({ 'claude-a': 1.25, 'claude-b': 1.1, zai: 1.6 });
    r.records.push({ ticketId: 'T-0121', persona: 'ben', costUsd: 0.4, startedAt: RIG_NOW.toISOString(), endedAt: RIG_NOW.toISOString(), grant: { model: 'sonnet' } });
    const decided = route(r.grant.choose(ask({ needs: { image: true } })));
    expect(decided).toMatchObject({ slot: 'claude-a', model: 'sonnet', class: 'B', requested: 'B', q: 1.25, estimatedUsd: 0.4, stepUp: null });
    expect(decided.line).toBe('route T-0121 → claude-a/sonnet: class B, q 1.25, est $0.40 · filtered: zai (no image input)');
  });

  it.each<[string, Record<string, number>, string, string]>([
    ['the largest surplus wins over the cheaper', { 'claude-a': 1.25, 'claude-b': 1.1, zai: 1.1 }, 'claude-a', 'sonnet'],
    ['same surplus → the cheaper cost factor', { 'claude-a': 1.2, 'claude-b': 1.2, zai: 1.2 }, 'zai', 'glm'],
    ['an account without a reading ranks as an even pace', { 'claude-a': 0.8, 'claude-b': 0.9 }, 'zai', 'glm'],
  ])('%s', async (_name, q, slotId, model) => {
    const r = await rig(q);
    expect(route(r.grant.choose(ask()))).toMatchObject({ slot: slotId, model });
  });
});

describe('the step up within the slot — only upwards, only above the threshold (req-178)', () => {
  it('above Upgrade above q the slot runs the next stronger model of the pool', async () => {
    const r = await rig({ 'claude-a': 1.5, 'claude-b': 1.0, zai: 1.0 });
    const decision = granted(r.grant.choose(ask()));
    expect(decision).toMatchObject({ model: 'opus', class: 'A', cost: 5, slot: { id: 'claude-a' } });
    expect(decision.reason).toBe('opus, class A, cost 5 on Claude A, a step up from sonnet (q 1.5) — size M → B');
    expect(decision.route).toMatchObject({ class: 'A', requested: 'B', stepUp: { from: 'sonnet', fromClass: 'B' } });
    expect(decision.route!.line).toBe('route T-0121 → claude-a/opus: class A (step up from sonnet, B), q 1.5, est ?');
  });

  it.each<[string, Record<string, number>, Partial<ClassRequest>, Record<string, unknown> | undefined, string]>([
    ['never onto another slot: Claude B serves no opus', { 'claude-a': 1.0, 'claude-b': 1.6, zai: 1.0 }, {}, undefined, 'sonnet'],
    ['not at the threshold itself', { 'claude-a': 1.3, 'claude-b': 1.0, zai: 1.0 }, {}, undefined, 'sonnet'],
    ['a raised threshold', { 'claude-a': 1.5, 'claude-b': 1.0, zai: 1.0 }, {}, { upgradeAboveQ: 1.6 }, 'sonnet'],
    ['switched off', { 'claude-a': 1.9, 'claude-b': 1.0, zai: 1.0 }, {}, { upgradeAboveQ: null }, 'sonnet'],
    ['never on a pin (stepUp false)', { 'claude-a': 1.9, 'claude-b': 1.0, zai: 1.0 }, { stepUp: false }, undefined, 'sonnet'],
    ['never past the persona pool', { 'claude-a': 1.9, 'claude-b': 1.0, zai: 1.0 }, { pool: POOL.slice(1) }, undefined, 'sonnet'],
  ])('stays: %s', async (_name, q, over, routing, model) => {
    const r = await rig(q, routing);
    expect(granted(r.grant.choose(ask(over))).model).toBe(model);
  });

  it('stays when the stronger model has no room on the slot', async () => {
    const r = await rig({ 'claude-a': 1.9, 'claude-b': 1.0, zai: 1.0 });
    r.gate.bind({ ticketId: 'T-0001', provider: 'claude-code', model: 'opus', poolClass: 'A' } as RunRequest, 'R-1', { prefer: null, persona: 'ben' });
    expect(granted(r.grant.choose(ask({ pool: POOL.slice(0, 2) })))).toMatchObject({ model: 'sonnet', class: 'B' });
  });

  it('never a smaller class: an A request whose slot is busy waits, though sonnet has surplus', async () => {
    const r = await rig({ 'claude-a': 1.9, 'claude-b': 1.9 });
    r.gate.bind({ ticketId: 'T-0001', provider: 'claude-code', model: 'opus', poolClass: 'A' } as RunRequest, 'R-1', { prefer: null, persona: 'ben' });
    expect(r.grant.choose(ask({ class: 'A' }))).toEqual({ kind: 'wait', reason: 'capacity', line: 'waits for a A slot', detail: 'Claude A: 1 of 1 opus sessions busy' });
  });
});

describe('the reserve per window (req-178)', () => {
  it('a slot whose window would fall below the reserve is filtered; none left → the run waits', async () => {
    const r = await rig({ zai: 1.0 });
    await r.windows('claude-a', [windowWithQ(0.24)]); // 12 % left
    await r.windows('claude-b', [windowWithQ(1.6)]);
    expect(route(r.grant.choose(ask({ pool: [{ provider: null, model: 'sonnet' }] })))).toMatchObject({ slot: 'claude-b', filtered: expect.arrayContaining([{ slot: 'claude-a', model: 'sonnet', reason: 'reserve' }]) });
    await r.windows('claude-b', [windowWithQ(0.28)]); // 14 % left
    expect(r.grant.choose(ask({ pool: [{ provider: null, model: 'sonnet' }] }))).toMatchObject({
      kind: 'wait',
      reason: 'capacity',
      line: 'waits for a B slot',
      detail: 'Claude A: 7d window 12 % left, a run takes about 5 %, 10 % is kept in reserve; Claude B: 7d window 14 % left, a run takes about 5 %, 10 % is kept in reserve',
    });
  });
});

describe("the start's gate keeps the dispatch's routing (req-178)", () => {
  it('a stepped-up start runs at its routed class and records the dispatch\'s route', async () => {
    const r = await rig({ 'claude-a': 1.5, 'claude-b': 1.0, zai: 1.0 });
    const dispatched = granted(r.grant.choose(ask()));
    const start = { ticketId: 'T-0121', provider: 'claude-code', model: 'opus', poolClass: 'B', poolRoute: dispatched.route } as RunRequest;
    const bound = r.gate.bind(start, 'R-1', { prefer: 'claude-b', persona: 'ben' });
    expect(bound).toMatchObject({ id: 'claude-a', grant: { requested: 'B', class: 'A', model: 'opus', route: dispatched.route } });
  });

  it("the gate filters a start's needs again", async () => {
    const r = await rig({ zai: 1.0 });
    const start = { ticketId: 'T-0121', provider: 'opencode', model: 'glm', poolClass: 'B', poolNeeds: { image: true } } as RunRequest;
    expect(r.gate.bind(start, 'R-1', { prefer: null, persona: 'ben' })).toEqual({ refused: 'glm on z.ai: no image input' });
  });
});
