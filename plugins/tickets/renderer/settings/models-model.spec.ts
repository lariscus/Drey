import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import {
  capacityPayload,
  checkedWords,
  chipOf,
  classAdded,
  classGroupsOf,
  classRemoved,
  classSessionsPayload,
  contextWords,
  foundCardsOf,
  harnessViewsOf,
  modelsPayload,
  parseCostFactor,
  slotSessionsLine,
  stepOf,
  storedRowOf,
} from './models-model';
import { discovery, pool, row, slot, slots } from './models-fixtures';

describe('the class groups', () => {
  it('groups the table by class in the engine order, with the live load', () => {
    const groups = classGroupsOf(pool, slots, i18n);
    expect(groups.map((g) => [g.name, g.count, g.busy, g.sessions, g.rows.map((r) => r.row.model)])).toEqual([
      ['heavy', '1 model', '1/2 busy', 2, ['claude-opus-5-5']],
      ['standard', '2 models', '2 busy', null, ['claude-sonnet-5-5', 'zai-coding-plan/glm-5.3']],
      ['light', '0 models', '0/6 busy', 6, []],
    ]);
  });

  it('keeps the table index of a row, so a write can name it', () => {
    const standard = classGroupsOf(pool, slots, i18n)[1]!;
    expect(standard.rows.map((r) => r.index)).toEqual([1, 2]);
  });

  it('shows a row whose class the list lacks after the listed ones', () => {
    const groups = classGroupsOf({ ...pool, models: [...pool.models, row({ model: 'odd', class: 'legacy' })] }, slots, i18n);
    expect(groups.map((g) => g.name)).toEqual(['heavy', 'standard', 'light', 'legacy']);
  });

  it('reads the capabilities and the cost of a row', () => {
    const opus = classGroupsOf(pool, slots, i18n)[0]!.rows[0]!;
    expect([opus.tools, opus.image, opus.context, opus.cost, opus.chip]).toEqual([true, true, '1M', '×5', 'Claude Code · Claude A']);
  });
});

describe('the chip: harness and account', () => {
  it('names the row own account', () => {
    expect(chipOf({ slot: 'zai', provider: 'opencode' }, slots, discovery.harnesses, i18n)).toBe('opencode · z.ai');
  });

  it('names the single account of a provider row, or counts several', () => {
    expect(chipOf({ slot: null, provider: 'claude-code' }, slots, discovery.harnesses, i18n)).toBe('Claude Code · Claude A');
    expect(chipOf({ slot: null, provider: 'opencode' }, slots, discovery.harnesses, i18n)).toBe('opencode · 2 accounts');
  });

  it('is the harness alone when no account serves it', () => {
    expect(chipOf({ slot: null, provider: 'copilot' }, slots, discovery.harnesses, i18n)).toBe('Copilot CLI');
  });
});

describe('words', () => {
  it('abbreviates the context window', () => {
    expect([1_000_000, 256_000, 128_000, 1_500_000, undefined].map((n) => contextWords(n, i18n))).toEqual(['1M', '256k', '128k', '1.5M', '']);
  });

  it('says when the harnesses were asked', () => {
    const at = new Date('2026-11-13T10:02:00.000Z');
    expect(checkedWords(discovery, at, i18n)).toBe('Checked 2 min ago');
    expect(checkedWords(discovery, new Date('2026-11-13T10:00:20.000Z'), i18n)).toBe('Checked just now');
    expect(checkedWords(discovery, new Date('2026-11-13T13:00:00.000Z'), i18n)).toBe('Checked 3 h ago');
    expect(checkedWords({ ...discovery, checkedAt: null }, at, i18n)).toBe('Not checked yet');
    expect(checkedWords({ ...discovery, running: true }, at, i18n)).toBe('Checking…');
  });

  it('lists a harness with its providers, else its sign-in state', () => {
    const views = harnessViewsOf(discovery, i18n);
    expect(views.map((v) => [v.label, v.version, v.state, v.models, v.installed])).toEqual([
      ['Claude Code', '2.1.319', 'signed in', '2 models', true],
      ['opencode', '2.0.32', 'zai-coding-plan, github-copilot', '1 model', true],
      ['Copilot CLI', '', 'not installed', '0 models', false],
    ]);
  });
});

describe('the new-model cards', () => {
  it('shows what was found with its account chip and the suggested class', () => {
    expect(foundCardsOf(pool, slots, i18n)).toEqual([{ key: 'opencode:zai-coding-plan/glm-5.3-air', provider: 'opencode', model: 'zai-coding-plan/glm-5.3-air', chip: 'opencode · z.ai', suggested: 'light' }]);
  });
});

describe('what a write sends', () => {
  it('moves one row: the whole table, the row with its new class, capabilities and the off switch kept', () => {
    const payload = modelsPayload(pool.models, 0, { class: 'standard' });
    expect(payload.models).toHaveLength(3);
    expect(payload.models[0]).toEqual({ model: 'claude-opus-5-5', slot: 'a', category: 'everyday', class: 'standard', cost: 5, input: ['text', 'image'], tools: true, context: 1_000_000 });
    expect(payload.models[2]).toMatchObject({ enabled: false, slot: 'zai' });
    expect(payload.models[1]).toEqual(storedRowOf(pool.models[1]!));
  });

  it('writes a provider row by its provider, not a slot', () => {
    expect(storedRowOf(row({ model: 'm', provider: 'kimi' }))).toEqual({ model: 'm', provider: 'kimi', category: 'everyday', class: 'standard', cost: 1 });
  });

  it('switches a row off and sets a cost factor', () => {
    expect(modelsPayload(pool.models, 1, { enabled: false }).models[1]).toMatchObject({ enabled: false });
    expect(modelsPayload(pool.models, 1, { cost: 2 }).models[1]).toMatchObject({ cost: 2 });
  });

  it('writes one class cap and keeps the other classes', () => {
    expect(classSessionsPayload(pool.classes, 'light', 4).classes).toEqual([
      { name: 'heavy', sessions: 2 },
      { name: 'standard', sessions: null },
      { name: 'light', sessions: 4 },
    ]);
  });

  it('keeps the per-slot caps when the global cap is written', () => {
    expect(capacityPayload({ ...pool, capacity: { global: 6, perSlot: { a: 5 } } }, 8)).toEqual({ capacity: { global: 8, perSlot: { a: 5 } } });
  });
});

describe('the class list', () => {
  it('adds a class above another or last, in lower case', () => {
    const above = classAdded(pool.classes, 'Super Heavy', 'heavy');
    expect(above.ok && above.classes.map((c) => c.name)).toEqual(['super heavy', 'heavy', 'standard', 'light']);
    const last = classAdded(pool.classes, 'tiny', null);
    expect(last.ok && last.classes.map((c) => c.name)).toEqual(['heavy', 'standard', 'light', 'tiny']);
  });

  it('refuses a name that does not read and one that exists', () => {
    expect(classAdded(pool.classes, '  ', null)).toEqual({ ok: false, error: 'name' });
    expect(classAdded(pool.classes, 'Heavy', null)).toEqual({ ok: false, error: 'taken' });
  });

  it('removes an empty class only', () => {
    expect(classRemoved(pool.classes, pool.models, 'light').map((c) => c.name)).toEqual(['heavy', 'standard']);
    expect(classRemoved(pool.classes, pool.models, 'heavy')).toBe(pool.classes);
  });
});

describe('typed numbers and steppers', () => {
  it('reads a cost factor: a comma counts, nothing negative', () => {
    expect(parseCostFactor('0,4')).toEqual({ ok: true, value: 0.4 });
    expect(parseCostFactor('-1')).toEqual({ ok: false });
    expect(parseCostFactor('')).toEqual({ ok: false });
  });

  it('steps a cap: minus at 1 lifts it, plus on no cap starts at 1', () => {
    expect([stepOf(6, 1), stepOf(2, -1), stepOf(1, -1), stepOf(null, 1), stepOf(null, -1)]).toEqual([7, 1, null, 1, null]);
  });
});

describe('the desk Runners line', () => {
  it('lists the slots and the sessions each serves', () => {
    expect(slotSessionsLine([slot({ id: 'a', label: 'Claude A', total: 2 }), slot({ id: 'z', label: 'z.ai', total: null })], i18n)).toBe('Claude A 2 · z.ai');
  });

  it('says so when no slot is known', () => {
    expect(slotSessionsLine([], i18n)).toBe('No slots yet');
  });
});
