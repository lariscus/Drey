import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { DEFAULT_CLASSES } from './class-config';
import { ModelTable } from './model-table';
import { parsePoolSettings, poolKeysOf } from './pool-config';
import { POOL_SIZE_MIGRATION, PoolMigration } from './pool-migration';
import { RequestQueue } from './request-queue';
import { FakeClock, slot } from './routing.fake';
import { ServiceConfigFile } from './service-config-file';

const SLOTS = [slot({ id: 'claude-a', label: 'Claude A' }), slot({ id: 'claude-b', label: 'Claude B' }), slot({ id: 'zai', provider: 'opencode' })];

describe('parsePoolSettings — the pool keys of service.json (req-170)', () => {
  it('reads the rows, the cap and the ledgers; a broken row is left out with its reason, the others stand', () => {
    const parsed = parsePoolSettings(
      {
        models: [
          { model: 'claude-opus-4-1', slot: 'claude-a', category: 'frontier', class: 'A', cost: 5, sessions: 1 },
          { model: 'glm-5.3', provider: 'opencode', class: 'standard', cost: 0.4, sessions: 3 },
          { model: 'gpt-5.4', slot: 'copilot', class: 'B' },
          { model: 'kimi-k2.5', provider: 'kimi', class: 'D' },
          { model: 'claude-opus-4-1', slot: 'claude-a', class: 'heavy' },
          { model: 'x', provider: 'kimi', class: 'C', enabled: false },
        ],
        capacity: { global: 6, perSlot: { 'claude-a': 5, zai: 'lots' } },
        ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
      },
      SLOTS,
    );
    // req-287: a letter reads as its name, an old `sessions` is not read, `enabled` defaults to true.
    expect(parsed.settings.models).toEqual([
      { model: 'claude-opus-4-1', slot: 'claude-a', provider: 'claude-code', category: 'frontier', class: 'heavy', cost: 5, enabled: true },
      { model: 'glm-5.3', slot: null, provider: 'opencode', category: '', class: 'standard', cost: 0.4, enabled: true },
      { model: 'x', slot: null, provider: 'kimi', category: '', class: 'light', cost: 1, enabled: false },
    ]);
    expect(parsed.settings.classes).toEqual(DEFAULT_CLASSES);
    expect(parsed.settings.capacity).toEqual({ global: 6, perSlot: { 'claude-a': 5 } });
    expect(parsed.settings.ledgers).toEqual({ ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 });
    expect(parsed.errors).toEqual([
      'model "gpt-5.4" names slot "copilot", which service.json does not define',
      'model "kimi-k2.5": class must be one of super heavy, heavy, standard, light',
      'model "claude-opus-4-1" is named twice for claude-a',
      'capacity.perSlot.zai must be a number of 0 or more',
    ]);
  });

  it('req-287: reads the class list strongest first with its session caps; a row of a class the list does not hold is left out', () => {
    const parsed = parsePoolSettings(
      {
        classes: ['super heavy', { name: 'Heavy', sessions: 2 }, { name: 'light' }, { name: 'heavy', sessions: 9 }, { name: 'bad!' }, { name: 'tiny', sessions: -1 }],
        models: [
          { model: 'opus', slot: 'claude-a', class: 'heavy' },
          { model: 'sonnet', slot: 'claude-a', class: 'standard' },
        ],
      },
      SLOTS,
    );
    expect(parsed.settings.classes).toEqual([
      { name: 'super heavy', sessions: null },
      { name: 'heavy', sessions: 2 },
      { name: 'light', sessions: null },
      { name: 'tiny', sessions: null },
    ]);
    expect(parsed.settings.models.map((r) => r.model)).toEqual(['opus']);
    expect(parsed.errors).toEqual([
      `a class needs a name of letters, digits, spaces or '-' (got "bad!")`,
      'class "tiny": sessions must be a whole number of 0 or more',
      'model "sonnet": class must be one of super heavy, heavy, light, tiny',
    ]);
    expect(poolKeysOf(parsed.settings)['classes']).toEqual([{ name: 'super heavy' }, { name: 'heavy', sessions: 2 }, { name: 'light' }, { name: 'tiny' }]);
  });

  it('round-trips through the stored shape (a row keeps its slot, or its provider)', () => {
    const parsed = parsePoolSettings({ classes: [{ name: 'heavy', sessions: 1 }, 'standard', 'light'], models: [{ model: 'm', slot: 'claude-b', class: 'B' }, { model: 'n', provider: 'opencode', class: 'light', cost: 0.3, enabled: false }] }, SLOTS);
    expect(parsePoolSettings(poolKeysOf(parsed.settings), SLOTS).settings).toEqual(parsed.settings);
  });

  it('a provider row serves every slot of the provider; a slot row only its slot', () => {
    const table = new ModelTable(parsePoolSettings({ models: [{ model: 'sonnet', provider: 'claude-code', class: 'standard' }, { model: 'opus', slot: 'claude-a', class: 'heavy', cost: 5 }] }, SLOTS).settings.models);
    expect(table.rowOn('sonnet', SLOTS[1]!)?.class).toBe('standard');
    expect(table.rowOn('opus', SLOTS[1]!)).toBeNull();
  });
});

describe('parsePoolSettings — the capability columns and the routing (req-178)', () => {
  it('reads the declared columns; an input the routing does not ask about is dropped, a wrong kind leaves the row out', () => {
    const parsed = parsePoolSettings(
      {
        models: [
          { model: 'opus', slot: 'claude-a', class: 'heavy', input: ['text', 'image', 'pdf'], tools: true, context: 1_000_000, output: 128_000 },
          { model: 'glm', provider: 'opencode', class: 'standard' },
          { model: 'bad-input', provider: 'opencode', class: 'standard', input: 'image' },
          { model: 'bad-tools', provider: 'opencode', class: 'standard', tools: 'yes' },
          { model: 'bad-context', provider: 'opencode', class: 'standard', context: 12.5 },
        ],
      },
      SLOTS,
    );
    expect(parsed.settings.models.map((r) => [r.model, r.input, r.tools, r.context, r.output])).toEqual([
      ['opus', ['text', 'image'], true, 1_000_000, 128_000],
      ['glm', undefined, undefined, undefined, undefined],
    ]);
    expect(parsed.errors).toEqual([
      'model "bad-input": input must be a list such as ["text", "image"]',
      'model "bad-tools": tools must be true or false',
      'model "bad-context": context must be a whole number of tokens',
    ]);
    expect(poolKeysOf(parsed.settings)['models']).toEqual([
      { model: 'opus', slot: 'claude-a', category: '', class: 'heavy', cost: 1, input: ['text', 'image'], tools: true, context: 1_000_000, output: 128_000 },
      { model: 'glm', provider: 'opencode', category: '', class: 'standard', cost: 1 },
    ]);
  });

  it.each<[string, unknown, { upgradeAboveQ: number | null; reservePerWindow: number; burnRate: number }, string[]]>([
    ['absent: board 7l defaults', undefined, { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 }, []],
    ['set', { upgradeAboveQ: 1.5, reservePerWindow: 0.2, burnRate: 0.3 }, { upgradeAboveQ: 1.5, reservePerWindow: 0.2, burnRate: 0.3 }, []],
    ['null switches the step up off; 0 the reserve and the burn rate', { upgradeAboveQ: null, reservePerWindow: 0, burnRate: 0 }, { upgradeAboveQ: null, reservePerWindow: 0, burnRate: 0 }, []],
    [
      'out of range: the default, said once each',
      { upgradeAboveQ: -1, reservePerWindow: 10, burnRate: 1 },
      { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 },
      [
        'routing.upgradeAboveQ must be a surplus above 0, or null to never step up',
        'routing.reservePerWindow must be a share from 0 to below 1 (0.1 = 10 %)',
        'routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)',
      ],
    ],
    ['a burn rate that is not a number', { burnRate: '20 %' }, { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 }, ['routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)']],
  ])('routing — %s', (_name, routing, expected, errors) => {
    const parsed = parsePoolSettings(routing === undefined ? {} : { routing }, SLOTS);
    expect(parsed.settings.routing).toEqual(expected);
    expect(parsed.errors).toEqual(errors);
    expect(poolKeysOf(parsed.settings)['routing']).toEqual(expected);
  });
});

describe('PoolMigration — req-63 pool sizes into the slots, once', () => {
  it("sets the sessions of the slots that name none, writes the implied slots out, and never runs twice", async () => {
    const fs = new MemoryFileSystem();
    const file = new ServiceConfigFile(fs, '/home/.drey-engine/service.json');
    await fs.writeAtomic(file.path, JSON.stringify({ slots: [{ id: 'claude-a', provider: 'claude-code' }, { id: 'zai', provider: 'opencode', sessions: 3 }], other: 1 }));
    const logs: string[] = [];
    const migration = new PoolMigration(file, (line) => logs.push(line));
    expect(await migration.run({ 'claude-code': 2, opencode: 1, kimi: 1 })).toBe(true);
    const { root } = await file.read();
    expect(root).toEqual({
      other: 1,
      slots: [
        { id: 'claude-a', provider: 'claude-code', sessions: 2 },
        { id: 'zai', provider: 'opencode', sessions: 3 },
        { id: 'kimi', label: 'Kimi', provider: 'kimi', quota: 'counting', sessions: 1 },
      ],
      migrations: [POOL_SIZE_MIGRATION],
    });
    expect(await migration.run({ 'claude-code': 5 })).toBe(false);
    expect(logs).toHaveLength(1);
  });

  it('leaves a file that does not parse alone', async () => {
    const fs = new MemoryFileSystem();
    const file = new ServiceConfigFile(fs, '/s.json');
    await fs.writeAtomic(file.path, '{ broken');
    expect(await new PoolMigration(file, () => undefined).run({ kimi: 1 })).toBe(false);
    expect(await fs.readTextOrNull('/s.json')).toBe('{ broken');
  });
});

describe('RequestQueue — the tasks waiting for the pool', () => {
  const wait = (ticket: string): Parameters<RequestQueue['wait']>[0] => ({ ticket, persona: 'ben', class: 'standard', reason: 'capacity', line: 'waits for a standard slot', detail: 'standard runs 2 of at most 2 sessions' });

  it("is rebuilt by every pass in the pass's order; a task that keeps waiting keeps its since", () => {
    const clock = new FakeClock(new Date('2026-11-09T12:00:00Z'));
    const queue = new RequestQueue(clock);
    queue.begin();
    queue.wait(wait('T-2'));
    queue.wait(wait('T-1'));
    queue.wait(wait('T-2'));
    queue.end();
    expect(queue.list().map((e) => [e.ticket, e.position, e.since])).toEqual([
      ['T-2', 1, '2026-11-09T12:00:00.000Z'],
      ['T-1', 2, '2026-11-09T12:00:00.000Z'],
    ]);
    clock.advance(60_000);
    queue.begin();
    queue.wait(wait('T-1'));
    queue.wait(wait('T-3'));
    queue.end();
    expect(queue.list().map((e) => [e.ticket, e.position, e.since])).toEqual([
      ['T-1', 1, '2026-11-09T12:00:00.000Z'],
      ['T-3', 2, '2026-11-09T12:01:00.000Z'],
    ]);
    queue.clear();
    expect(queue.list()).toEqual([]);
  });
});
