import { describe, expect, it } from 'vitest';
import type { ClassRequest, RunInfo, RunRequest } from '../protocol';
import { CapacityCap } from './capacity-cap';
import { Ledgers } from './ledgers';
import { PoolGate } from './pool-gate';
import type { PoolGrant, ProviderThrottle } from './pool-grant';
import { PoolSettingsRegistry } from './pool-settings';
import { FakeClock, FakeQuotaSource, grantOf, slot } from './routing.fake';
import { SessionBook } from './session-book';
import type { Slot } from './slot';
import { SlotRegistry } from './slot-registry';
import { SlotReservations } from './slot-reservations';
import { SlotStateResolver } from './slot-state-resolver';
import { SurplusCalculator } from './surplus-calculator';

const NOW = new Date('2026-11-09T12:00:00Z');
const claudeA = slot({ id: 'claude-a', label: 'Claude A', sessions: 4 });
const zai = slot({ id: 'zai', label: 'z.ai', provider: 'opencode' });
const kimi = slot({ id: 'kimi', label: 'Kimi', provider: 'kimi' });
const SLOTS: Slot[] = [claudeA, zai, kimi];

/** Board 7l's table in small: opus A 5 × 1, sonnet B 1 × 2 on Claude A; glm B 0.4 × 3 on z.ai; kimi C 0.3 × 2 on any Kimi slot. */
const TABLE = [
  { model: 'opus', slot: 'claude-a', category: 'frontier', class: 'A', cost: 5, sessions: 1 },
  { model: 'sonnet', slot: 'claude-a', category: 'everyday', class: 'B', cost: 1, sessions: 2 },
  { model: 'glm', slot: 'zai', category: 'everyday', class: 'B', cost: 0.4, sessions: 3 },
  { model: 'kimi-k2', provider: 'kimi', category: 'bulk', class: 'C', cost: 0.3, sessions: 2 },
];

interface Rig {
  readonly pool: PoolGrant;
  readonly gate: PoolGate;
  readonly cap: CapacityCap;
  readonly book: SessionBook;
  readonly registry: SlotRegistry;
  readonly settings: PoolSettingsRegistry;
}

async function rig(config: Record<string, unknown> = { models: TABLE }, throttle?: ProviderThrottle): Promise<Rig> {
  const reservations = new SlotReservations();
  const registry = new SlotRegistry({
    config: { load: () => Promise.resolve({ slots: SLOTS, errors: [], refreshMs: 60_000 }) },
    sourceOf: () => new FakeQuotaSource(),
    reservations,
    resolver: new SlotStateResolver(new SurplusCalculator()),
    clock: new FakeClock(NOW),
    onChange: () => undefined,
    log: () => undefined,
  });
  await registry.load();
  const settings = new PoolSettingsRegistry(() => undefined);
  settings.apply(config, SLOTS, null);
  const book = new SessionBook();
  const cap = new CapacityCap(settings, reservations);
  const pool = grantOf({ slots: registry, settings, cap, reservations, ledgers: new Ledgers(book, settings, new FakeClock(NOW)), records: book, ...(throttle !== undefined ? { throttle } : {}) });
  return { pool, gate: new PoolGate(registry, reservations, pool), cap, book, registry, settings };
}

const ask = (over: Partial<ClassRequest> = {}): ClassRequest => ({
  ticket: 'T-0001',
  persona: 'ben',
  class: 'B',
  pool: [{ provider: null, model: 'opus' }, { provider: null, model: 'sonnet' }, { provider: null, model: 'glm' }, { provider: null, model: 'kimi-k2' }],
  provider: 'claude-code',
  profile: 'private',
  contextTokens: null,
  ledger: { allowance: null, personaBudget: null, spendAboveAllowance: false },
  prefer: null,
  why: 'part M',
  ...over,
});

/** A start of one model, as the dispatch composes it after the class request. */
const start = (model: string, over: Partial<RunRequest> = {}): RunRequest => ({ ticketId: 'T-0001', provider: model === 'glm' ? 'opencode' : model === 'kimi-k2' ? 'kimi' : 'claude-code', model, ...over }) as RunRequest;
const ctx = { prefer: null, persona: 'ben' };
const run = (over: Partial<RunInfo>): RunInfo => ({ id: 'R-old', ticketId: 'T-0001', persona: 'ben', costUsd: 1, startedAt: NOW.toISOString(), slot: { id: 'claude-a', label: 'Claude A' }, ...over }) as RunInfo;

describe('PoolGrant — exactly the class asked for, or wait (req-170, R10)', () => {
  it('grants a model of exactly the class — never a stronger or a lighter one; same surplus → the cheaper (req-178)', async () => {
    const { pool } = await rig();
    expect(pool.choose(ask())).toMatchObject({ kind: 'grant', model: 'glm', class: 'B', cost: 0.4, slot: { id: 'zai' }, reason: 'glm, class B, cost 0.4 on z.ai — part M' });
    expect(pool.choose(ask({ pool: [{ provider: null, model: 'sonnet' }] }))).toMatchObject({ kind: 'grant', model: 'sonnet', class: 'B', cost: 1, slot: { id: 'claude-a' }, reason: 'sonnet, class B, cost 1 on Claude A — part M' });
    expect(pool.choose(ask({ class: 'C' }))).toMatchObject({ kind: 'grant', model: 'kimi-k2', class: 'C', slot: { id: 'kimi' } });
    expect(pool.choose(ask({ class: 'A' }))).toMatchObject({ kind: 'grant', model: 'opus', class: 'A' });
  });

  it('waits, never downgrades: the A row is busy, the free B rows are not offered', async () => {
    const { pool, gate } = await rig();
    expect(gate.bind(start('opus', { poolClass: 'A' }), 'R-1', ctx)).toMatchObject({ id: 'claude-a', grant: { requested: 'A', class: 'A', model: 'opus', cost: 5 } });
    expect(pool.choose(ask({ class: 'A' }))).toEqual({ kind: 'wait', reason: 'capacity', line: 'waits for a A slot', detail: 'Claude A: 1 of 1 opus sessions busy' });
    gate.release('R-1');
    expect(pool.choose(ask({ class: 'A' }))).toMatchObject({ kind: 'grant', model: 'opus' });
  });

  it("the slot's derived cap (its largest row at full sessions) and the global cap bound the sum of the active sessions", async () => {
    const { pool, gate, cap, registry } = await rig({ models: TABLE, capacity: { global: 6 } });
    gate.bind(start('opus', { poolClass: 'A' }), 'R-1', ctx);
    expect(pool.choose(ask({ pool: [{ provider: null, model: 'sonnet' }] }))).toMatchObject({ kind: 'wait', reason: 'capacity', detail: 'Claude A carries 5 of 5, 1 more does not fit' });
    gate.bind(start('glm', { poolClass: 'B' }), 'R-2', ctx);
    gate.bind(start('glm', { poolClass: 'B' }), 'R-3', ctx);
    expect(pool.choose(ask({ pool: [{ provider: null, model: 'glm' }] }))).toMatchObject({ kind: 'wait', detail: 'the global cap carries 5.8 of 6, 0.4 more does not fit' });
    expect(cap.load(registry.views())).toEqual({
      used: 5.8,
      global: 6,
      slots: [
        { id: 'claude-a', label: 'Claude A', used: 5, cap: 5, derived: true },
        { id: 'zai', label: 'z.ai', used: 0.8, cap: 1.2, derived: true },
        { id: 'kimi', label: 'Kimi', used: 0, cap: 0.6, derived: true },
      ],
    });
  });

  it('a weight above a cap can never fit: a configuration wait, not a capacity one', async () => {
    const { pool } = await rig({ models: TABLE, capacity: { perSlot: { 'claude-a': 2 } } });
    expect(pool.choose(ask({ class: 'A' }))).toMatchObject({ kind: 'wait', reason: 'config', line: 'waits: opus costs 5, above the cap of Claude A or the global cap — raise it in Settings → Models' });
  });

  it('a class the pool does not hold is a configuration wait', async () => {
    const { pool } = await rig();
    expect(pool.choose(ask({ class: 'C', pool: [{ provider: null, model: 'opus' }, { provider: null, model: 'sonnet' }] }))).toEqual({
      kind: 'wait',
      reason: 'config',
      line: "waits: ben's pool holds no class C model — add one in Settings → Models",
      detail: "ben's pool holds no class C model — add one in Settings → Models",
    });
  });

  it('a model the table does not hold runs only on a pin without a class, or while the table is empty', async () => {
    const tabled = await rig();
    expect(tabled.pool.choose(ask({ class: null, pool: [{ provider: null, model: 'haiku' }] }))).toMatchObject({ kind: 'grant', model: 'haiku', class: null, cost: 1, reason: 'haiku (not in the model table) on Claude A — part M' });
    expect(tabled.pool.choose(ask({ pool: [{ provider: null, model: 'haiku' }] }))).toMatchObject({ kind: 'wait', reason: 'config' });
    const empty = await rig({});
    expect(empty.pool.choose(ask({ pool: [{ provider: null, model: 'haiku' }] }))).toMatchObject({ kind: 'grant', model: 'haiku', class: null });
  });

  it('a provider throttle (a spent quota, a rate limit) holds that provider only', async () => {
    const paused: ProviderThrottle = { refusal: (provider) => (provider === 'claude-code' ? 'claude-code is out of quota until 12:30' : null) };
    const { pool } = await rig({ models: TABLE }, paused);
    expect(pool.choose(ask())).toMatchObject({ kind: 'grant', model: 'glm', slot: { id: 'zai' } });
  });
});

describe('PoolGrant — the three ledgers (req-170)', () => {
  it("a spent ticket allowance grants nothing; the persona's allowed: spend-above-allowance runs on", async () => {
    const { pool, book } = await rig({ models: TABLE, ledgers: { ticketAllowance: 2.5 } });
    book.seed([run({ id: 'R-a', costUsd: 1.5 }), run({ id: 'R-b', costUsd: 1.1 }), run({ id: 'R-c', ticketId: 'T-0002', costUsd: 9 })]);
    expect(pool.choose(ask())).toMatchObject({ kind: 'wait', reason: 'ledger', line: 'waits: T-0001 has spent $2.60 of its $2.50 allowance', ledger: { ledger: 'ticket', key: 'ledger-ticket' } });
    expect(pool.choose(ask({ ledger: { allowance: 5, personaBudget: null, spendAboveAllowance: false } }))).toMatchObject({ kind: 'grant' });
    expect(pool.choose(ask({ ledger: { allowance: null, personaBudget: null, spendAboveAllowance: true } }))).toMatchObject({ kind: 'grant' });
  });

  it("the persona's day counts today's sessions only; budget: beats the default", async () => {
    const { pool, book } = await rig({ models: TABLE, ledgers: { personaPerDay: 5 } });
    book.seed([run({ id: 'R-a', ticketId: 'T-0009', costUsd: 4 }), run({ id: 'R-b', ticketId: 'T-0009', costUsd: 3, startedAt: '2026-11-08T23:00:00Z' })]);
    expect(pool.choose(ask())).toMatchObject({ kind: 'grant' });
    expect(pool.choose(ask({ ledger: { allowance: null, personaBudget: 4, spendAboveAllowance: true } }))).toMatchObject({ kind: 'wait', reason: 'ledger', ledger: { key: 'ledger-persona-ben' } });
  });

  it("a slot's spent day moves the request to the next slot of its class; with none left it waits on the ledger", async () => {
    const { pool, book } = await rig({ models: TABLE, ledgers: { providerPerDay: 3 } });
    book.seed([run({ id: 'R-a', ticketId: 'T-0009', persona: 'tessa', costUsd: 3 })]);
    expect(pool.choose(ask())).toMatchObject({ kind: 'grant', model: 'glm', slot: { id: 'zai' } });
    expect(pool.choose(ask({ pool: [{ provider: null, model: 'sonnet' }] }))).toMatchObject({ kind: 'wait', reason: 'ledger', line: 'waits: Claude A has spent $3.00 of $3.00 today' });
  });
});
