import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { ModelRow, ModelsReply, SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol';
import {
  billingWords,
  blankRowOf,
  capacityPayload,
  capacityViewOf,
  classesOfSlot,
  isWorkRow,
  ledgerPayload,
  modelRowsOf,
  modelsPayload,
  moneyText,
  parseCap,
  parseCostFactor,
  parseMoney,
  parseSessions,
  placeOptionsOf,
  resetWords,
  parseRouting,
  rowPlaced,
  routingPayload,
  routingViewOf,
  slotCardsOf,
  slotSessionsLine,
} from './models-model';

const row = (extra: Partial<ModelRow> & Pick<ModelRow, 'model'>): ModelRow => ({
  slot: null,
  provider: 'claude-code',
  category: 'everyday',
  class: 'B',
  cost: 1,
  sessions: 2,
  ...extra,
});

const slot = (extra: Partial<SlotView> & Pick<SlotView, 'id' | 'label'>): SlotView => ({
  provider: 'claude-code',
  profile: 'private',
  billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' },
  quota: 'claude-code',
  state: 'ready',
  busy: 0,
  total: 2,
  windows: [],
  q: null,
  reason: null,
  lastFetch: null,
  lastFetchError: null,
  implied: false,
  ...extra,
});

const window = (name: string, remaining: number | null, resetsAt: string | null, reliability: 'measured' | 'estimated' | 'unknown' = 'measured') => ({
  name,
  spanMs: null,
  remaining,
  resetsAt,
  reliability,
  fetchedAt: null,
});

const reply = (extra: Partial<ModelsReply> = {}): ModelsReply => ({
  ok: true,
  models: [
    row({ model: 'claude-opus-4-1', slot: 'claude-a', category: 'frontier', class: 'A', cost: 5, sessions: 1 }),
    row({ model: 'glm-5.3', slot: 'zai', provider: 'opencode', cost: 0.4, sessions: 3 }),
    row({ model: 'gpt-5.4', slot: 'copilot', provider: 'opencode' }),
  ],
  capacity: { global: 6, perSlot: { 'claude-a': 5 } },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: null },
  now: {
    used: 2.4,
    global: 6,
    slots: [
      { id: 'claude-a', label: 'Claude A', used: 2, cap: 5, derived: false },
      { id: 'zai', label: 'z.ai', used: 0.4, cap: 1.2, derived: true },
      { id: 'kimi', label: 'Kimi', used: 0, cap: 0.6, derived: true },
    ],
  },
  queue: [],
  providerDay: [],
  errors: [],
  configPath: 'service.json',
  ...extra,
});

const slots: readonly SlotView[] = [
  slot({ id: 'claude-a', label: 'Claude A' }),
  slot({ id: 'zai', label: 'z.ai', provider: 'opencode' }),
  slot({ id: 'copilot', label: 'Copilot', provider: 'opencode', profile: 'work', billing: { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' } }),
];

describe('the model table rows', () => {
  it('names the slot in the provider column and trims the numbers', () => {
    const [opus, glm] = modelRowsOf(reply(), slots, i18n);
    expect(opus).toMatchObject({ provider: 'Claude A', cost: '5', sessions: '1', work: false });
    expect(glm).toMatchObject({ provider: 'z.ai', cost: '0.4', sessions: '3' });
  });

  it('marks a row that runs on work slots only, for the dimmed row and its chip', () => {
    expect(modelRowsOf(reply(), slots, i18n).map((r) => r.work)).toEqual([false, false, true]);
    expect(isWorkRow(row({ model: 'm', provider: 'opencode' }), slots)).toBe(false);
  });

  it('is empty while no runner answers', () => {
    expect(modelRowsOf(null, slots, i18n)).toEqual([]);
  });

  it('falls back to the runner when a row names no slot', () => {
    const [plain] = modelRowsOf(reply({ models: [row({ model: 'x', provider: 'kimi' })] }), [], i18n);
    expect(plain?.provider).toBe('Kimi Code');
  });
});

describe('editing the table', () => {
  it('offers every slot, then the runners no slot names', () => {
    const options = placeOptionsOf(slots);
    expect(options.map((o) => o.label)).toEqual(['Claude A', 'z.ai', 'Copilot', 'Kimi Code']);
    expect(options.map((o) => o.value)).toEqual(['slot:claude-a', 'slot:zai', 'slot:copilot', 'provider:kimi']);
  });

  it('moves a row to a slot (with its provider) or to a bare runner', () => {
    const base = row({ model: 'm' });
    expect(rowPlaced(base, 'slot:zai', slots)).toMatchObject({ slot: 'zai', provider: 'opencode' });
    expect(rowPlaced({ ...base, slot: 'zai' }, 'provider:kimi', slots)).toMatchObject({ slot: null, provider: 'kimi' });
  });

  it('sends the whole table, a row keeping its slot or its provider', () => {
    const payload = modelsPayload([row({ model: 'a', slot: 'zai', provider: 'opencode' }), row({ model: 'b', provider: 'kimi' })]);
    expect(payload.models[0]).toEqual({ model: 'a', slot: 'zai', category: 'everyday', class: 'B', cost: 1, sessions: 2 });
    expect(payload.models[1]).toEqual({ model: 'b', provider: 'kimi', category: 'everyday', class: 'B', cost: 1, sessions: 2 });
  });

  it('starts a new row on the first place there is', () => {
    expect(blankRowOf(placeOptionsOf(slots), slots)).toMatchObject({ model: '', slot: 'claude-a', class: 'B', cost: 1, sessions: 1 });
  });

  it('reads typed numbers: a comma counts, nothing negative, sessions are whole', () => {
    expect(parseCostFactor('0,4')).toEqual({ ok: true, value: 0.4 });
    expect(parseCostFactor('-1').ok).toBe(false);
    expect(parseCostFactor('').ok).toBe(false);
    expect(parseSessions('3')).toEqual({ ok: true, value: 3 });
    expect(parseSessions('0').ok).toBe(false);
    expect(parseSessions('1.5').ok).toBe(false);
  });
});

describe('the Capacity group', () => {
  it('words the live load as the board does, listing the slots that carry sessions', () => {
    expect(capacityViewOf(reply(), i18n).now).toBe('Now: 2.4 of 6 · Claude A 2 of 5 · z.ai 0.4 of 1.2');
  });

  it('lists every slot cap in the read-only list and the global cap in the field', () => {
    const view = capacityViewOf(reply(), i18n);
    expect(view.global).toBe('6');
    expect(view.perProvider).toEqual([
      { label: 'Claude A', cap: '5' },
      { label: 'z.ai', cap: '1.2' },
      { label: 'Kimi', cap: '0.6' },
    ]);
  });

  it('says only the sum when there is no cap, and an en dash for a slot without one', () => {
    const open = reply({ capacity: { global: null, perSlot: {} }, now: { used: 1, global: null, slots: [{ id: 'a', label: 'A', used: 1, cap: null, derived: false }] } });
    const view = capacityViewOf(open, i18n);
    expect(view.global).toBe('');
    expect(view.now).toBe('Now: 1 · A 1');
    expect(view.perProvider[0]?.cap).toBe('–');
  });

  it('keeps the per-slot caps when the global cap is written', () => {
    expect(capacityPayload(reply(), 8)).toEqual({ capacity: { global: 8, perSlot: { 'claude-a': 5 } } });
    expect(parseCap('')).toEqual({ ok: true, value: null });
    expect(parseCap('x').ok).toBe(false);
  });
});

describe('the Ledgers group', () => {
  it('shows an amount as dollars and an empty field as no limit', () => {
    expect(moneyText(2.5, i18n)).toBe('$2.50');
    expect(moneyText(null, i18n)).toBe('');
    expect(parseMoney('$15.00')).toEqual({ ok: true, value: 15 });
    expect(parseMoney(' 2,5 ')).toEqual({ ok: true, value: 2.5 });
    expect(parseMoney('')).toEqual({ ok: true, value: null });
    expect(parseMoney('lots').ok).toBe(false);
  });

  it('writes one default and keeps the other two', () => {
    expect(ledgerPayload(reply(), 'providerPerDay', 15)).toEqual({ ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 } });
  });
});

describe('the slot cards', () => {
  const now = new Date(2026, 10, 9, 12, 0);
  const at = (day: number, hour: number, minute = 0): string => new Date(2026, 10, day, hour, minute).toISOString();

  it('draws a window as the board does: share, reset, reliability, the bar in pixels', () => {
    const claude = slot({
      id: 'claude-a',
      label: 'Claude A',
      windows: [window('5h', 0.78, at(9, 14, 20)), window('7d', 0.62, at(16, 9))],
      q: 1.4,
    });
    const [card] = slotCardsOf([claude], { rows: reply().models, routing: reply().routing }, now, i18n);
    expect(card).toMatchObject({ name: 'Claude A', profile: 'Private', billing: 'subscription · €90 / month', q: 'q 1.4 · upgrade allowed' });
    expect(card?.windows.map((w) => [w.label, w.text, w.reliability, w.bar?.width, w.bar?.low])).toEqual([
      ['5 h', '78 % left · resets 14:20', 'measured', 93.6, false],
      ['7 d', '62 % left · resets Mon 09:00', 'measured', 74.4, false],
    ]);
  });

  it('draws the part below the reserve peach, and says which classes a slot without surplus serves', () => {
    const low = slot({ id: 'zai', label: 'z.ai', provider: 'opencode', windows: [window('5h', 0.05, at(9, 15, 5), 'estimated')], q: 1.2 });
    const [card] = slotCardsOf([low], { rows: reply().models, routing: reply().routing }, now, i18n);
    expect(card?.windows[0]?.bar?.low).toBe(true);
    expect(card?.windows[0]?.reliability).toBe('estimated');
    expect(card?.q).toBe('q 1.2 · class B only');
  });

  it('shows a counted window as amounts, with the day of a far reset', () => {
    const copilot = slot({
      id: 'copilot',
      label: 'Copilot',
      provider: 'opencode',
      profile: 'work',
      quota: 'counting',
      billing: { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' },
      windows: [{ ...window('month', 0.412, new Date(2026, 11, 1).toISOString(), 'estimated'), used: 588, limit: 1000, unit: 'tokens' as const }],
      q: 0.9,
    });
    const [card] = slotCardsOf([copilot], { rows: reply().models, routing: reply().routing }, now, i18n);
    expect(card).toMatchObject({ profile: 'Work', billing: 'credits · €0.04 / credit' });
    expect(card?.windows[0]).toMatchObject({ label: 'month', text: '412 of 1,000 left · resets Dec 1' });
    expect(card?.windows[0]?.bar?.width).toBe(49.44);
  });

  it('gives a slot nothing measures the one unknown row, and no q', () => {
    const kimi = slot({ id: 'kimi', label: 'Kimi', provider: 'kimi', quota: 'counting', windows: [], q: null });
    const [card] = slotCardsOf([kimi], { rows: reply().models, routing: reply().routing }, now, i18n);
    expect(card?.windows).toEqual([]);
    expect(card?.unknownRow).toBe('counted from own usage');
    expect(card?.q).toBe('');
  });

  it('says a quota unknown when the provider should have measured it, and a login that is needed', () => {
    const lost = slot({ id: 'claude-b', label: 'Claude B', state: 'needs-login', windows: [] });
    const [card] = slotCardsOf([lost], { rows: [], routing: reply().routing }, now, i18n);
    expect(card?.unknownRow).toBe('quota unknown');
    expect(card?.q).toBe('needs login');
  });

  it('words a price as the slot has it, a missing one as the kind alone', () => {
    expect(billingWords({ kind: 'subscription', pricePerMonth: null }, i18n)).toBe('subscription');
    expect(billingWords({ kind: 'subscription', pricePerMonth: 19, currency: 'USD' }, i18n)).toBe('subscription · $19 / month');
    expect(billingWords(null, i18n)).toBe('');
  });

  it('lists the classes a slot serves, strongest first', () => {
    const rows = [row({ model: 'a', slot: 'claude-a', class: 'B' }), row({ model: 'b', slot: 'claude-a', class: 'A' }), row({ model: 'c', provider: 'kimi', class: 'C' })];
    expect(classesOfSlot(slot({ id: 'claude-a', label: 'x' }), rows)).toEqual(['A', 'B']);
    expect(classesOfSlot(slot({ id: 'k', label: 'k', provider: 'kimi' }), rows)).toEqual(['C']);
  });
});

describe('the reset words, in the locale through Intl', () => {
  const now = new Date(2026, 10, 9, 12, 0);
  it('is the clock time today, weekday and time within the week, the day beyond', () => {
    expect(resetWords(new Date(2026, 10, 9, 15, 5), now, i18n)).toBe('15:05');
    expect(resetWords(new Date(2026, 10, 15, 0, 0), now, i18n)).toBe('Sun 00:00');
    expect(resetWords(new Date(2026, 11, 1, 0, 0), now, i18n)).toBe('Dec 1');
  });
});

describe('the desk Runners line', () => {
  it('lists the slots and the sessions each serves', () => {
    expect(slotSessionsLine([slot({ id: 'a', label: 'Claude A', total: 2 }), slot({ id: 'b', label: 'Kimi', total: null })], i18n)).toBe('Claude A 2 · Kimi');
  });

  it('says so when no slot is known', () => {
    expect(slotSessionsLine([], i18n)).toBe('No slots yet');
  });
});

describe('the Routing group (req-178 / req-181): the engine values, checked like the engine', () => {
  const routing = { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 };

  it('shows the engine values: q as it is, the shares as percent, a q of null as empty', () => {
    expect(routingViewOf(routing, i18n)).toEqual({ upgradeAboveQ: '1.3', reservePerWindow: '10', burnRate: '20' });
    expect(routingViewOf({ upgradeAboveQ: null, reservePerWindow: 0.125, burnRate: 0 }, i18n)).toEqual({ upgradeAboveQ: '', reservePerWindow: '12.5', burnRate: '0' });
  });

  it.each<[string, string, number | null | 'invalid']>([
    ['upgradeAboveQ', '1.5', 1.5],
    ['upgradeAboveQ', '', null],
    ['upgradeAboveQ', '0', 'invalid'],
    ['upgradeAboveQ', 'high', 'invalid'],
    ['burnRate', '25', 0.25],
    ['burnRate', '12,5 %', 0.125],
    ['burnRate', '', 0],
    ['burnRate', '100', 'invalid'],
    ['reservePerWindow', '-5', 'invalid'],
    ['reservePerWindow', '0', 0],
  ])('%s "%s" reads as %s', (key, text, expected) => {
    const parsed = parseRouting(key as 'upgradeAboveQ' | 'reservePerWindow' | 'burnRate', text);
    expect(parsed.ok ? parsed.value : 'invalid').toBe(expected);
  });

  it('sends the whole routing key with the one field changed', () => {
    expect(routingPayload(routing, 'burnRate', 0.3)).toEqual({ routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.3 } });
  });

  it('the slot cards read the engine routing: the reserve peach and the upgrade mark move with it', () => {
    const claude = slot({ id: 'claude-a', label: 'Claude A', windows: [window('7d', 0.15, new Date(2026, 10, 16, 9).toISOString())], q: 1.4 });
    const [card] = slotCardsOf([claude], { rows: [], routing: { upgradeAboveQ: 1.5, reservePerWindow: 0.2, burnRate: 0.2 } }, new Date(2026, 10, 9, 12), i18n);
    expect(card?.windows[0]?.bar?.low).toBe(true);
    expect(card?.q).toBe('q 1.4');
    const [never] = slotCardsOf([{ ...claude, q: 3 }], { rows: [], routing: { upgradeAboveQ: null, reservePerWindow: 0.1, burnRate: 0.2 } }, new Date(2026, 10, 9, 12), i18n);
    expect(never?.q).not.toContain('upgrade');
  });
});
