import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
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
          { model: 'glm-5.3', provider: 'opencode', class: 'B', cost: 0.4, sessions: 3 },
          { model: 'gpt-5.4', slot: 'copilot', class: 'B' },
          { model: 'kimi-k2.5', provider: 'kimi', class: 'D' },
          { model: 'claude-opus-4-1', slot: 'claude-a', class: 'A' },
          { model: 'x', provider: 'kimi', class: 'C', sessions: 0 },
        ],
        capacity: { global: 6, perSlot: { 'claude-a': 5, zai: 'lots' } },
        ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
      },
      SLOTS,
    );
    expect(parsed.settings.models).toEqual([
      { model: 'claude-opus-4-1', slot: 'claude-a', provider: 'claude-code', category: 'frontier', class: 'A', cost: 5, sessions: 1 },
      { model: 'glm-5.3', slot: null, provider: 'opencode', category: '', class: 'B', cost: 0.4, sessions: 3 },
    ]);
    expect(parsed.settings.capacity).toEqual({ global: 6, perSlot: { 'claude-a': 5 } });
    expect(parsed.settings.ledgers).toEqual({ ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 });
    expect(parsed.errors).toEqual([
      'model "gpt-5.4" names slot "copilot", which service.json does not define',
      'model "kimi-k2.5": class must be A, B or C',
      'model "claude-opus-4-1" is named twice for claude-a',
      'model "x": sessions must be a whole number of 1 or more',
      'capacity.perSlot.zai must be a number of 0 or more',
    ]);
  });

  it('round-trips through the stored shape (a row keeps its slot, or its provider)', () => {
    const parsed = parsePoolSettings({ models: [{ model: 'm', slot: 'claude-b', class: 'B' }, { model: 'n', provider: 'opencode', class: 'C', cost: 0.3 }] }, SLOTS);
    expect(parsePoolSettings(poolKeysOf(parsed.settings), SLOTS).settings).toEqual(parsed.settings);
  });

  it('a provider row serves every slot of the provider; a slot row only its slot', () => {
    const table = new ModelTable(parsePoolSettings({ models: [{ model: 'sonnet', provider: 'claude-code', class: 'B', sessions: 2 }, { model: 'opus', slot: 'claude-a', class: 'A', cost: 5 }] }, SLOTS).settings.models);
    expect(table.rowOn('sonnet', SLOTS[1]!)?.class).toBe('B');
    expect(table.rowOn('opus', SLOTS[1]!)).toBeNull();
    expect(table.derivedCap(SLOTS[0]!)).toBe(5);
    expect(table.derivedCap(SLOTS[1]!)).toBe(2);
    expect(table.derivedCap(SLOTS[2]!)).toBeNull();
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
        { id: 'kimi', label: 'Kimi', provider: 'kimi', profile: 'private', quota: 'counting', sessions: 1 },
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
  const wait = (ticket: string): Parameters<RequestQueue['wait']>[0] => ({ ticket, persona: 'ben', class: 'B', reason: 'capacity', line: 'waits for a B slot', detail: 'Claude A: 2 of 2 sonnet sessions busy' });

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
