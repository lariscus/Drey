import { describe, expect, it } from 'vitest';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
import { classChoicesOf, classCountsOf, classModelsOf, pinFitsClass, pinnedModelOf } from './persona-class-model';

const row = (model: string, over: Record<string, unknown> = {}) => ({ model, slot: null, provider: 'claude-code', category: 'x', class: 'heavy', cost: 3, enabled: true, ...over });
const table = {
  ok: true,
  classes: [{ name: 'super heavy' }, { name: 'heavy' }, { name: 'standard' }],
  models: [row('claude-opus-5-5'), row('kimi-k3.1-pro', { provider: 'kimi', slot: 'k' }), row('claude-opus-5-5', { slot: 'b' }), row('off-model', { enabled: false }), row('sonnet', { class: 'standard' })],
  now: { used: 0, global: null, slots: [], classes: [{ name: 'heavy', busy: 0, cap: 2 }] },
} as unknown as ModelsReply;
const slots = [
  { id: 'a', provider: 'claude-code', busy: 3, total: 3 },
  { id: 'b', provider: 'claude-code', busy: 3, total: 3 },
  { id: 'k', provider: 'kimi', busy: 0, total: 2 },
] as unknown as SlotView[];

describe('the Model block, pure half (req-288)', () => {
  it("offers the owner's classes, a stored class the list lacks, and the shipped list without a table", () => {
    expect(classChoicesOf(table, 'heavy')).toEqual(['super heavy', 'heavy', 'standard']);
    expect(classChoicesOf(table, 'tiny')).toEqual(['super heavy', 'heavy', 'standard', 'tiny']);
    expect(classChoicesOf(null, '')).toEqual(['super heavy', 'heavy', 'standard', 'light']);
  });

  it('lists the enabled models of a class once per harness, each with its harness', () => {
    expect(classModelsOf(table, 'heavy')).toEqual([
      { entry: 'claude-code/claude-opus-5-5', model: 'claude-opus-5-5', harness: 'Claude Code' },
      { entry: 'kimi/kimi-k3.1-pro', model: 'kimi-k3.1-pro', harness: 'Kimi Code' },
    ]);
    expect(classModelsOf(null, 'heavy')).toEqual([]);
  });

  it('reads a pin as its model and harness, and tells whether it fits a class', () => {
    expect(pinnedModelOf('kimi/kimi-k3.1-pro', table)).toMatchObject({ model: 'kimi-k3.1-pro', harness: 'Kimi Code' });
    expect(pinnedModelOf('sonnet', table)).toMatchObject({ model: 'sonnet', harness: 'Claude Code' });
    expect(pinnedModelOf('ghost', null).harness).toBe('');
    expect(pinFitsClass('claude-code/claude-opus-5-5', table, 'heavy')).toBe(true);
    expect(pinFitsClass('claude-code/claude-opus-5-5', table, 'standard')).toBe(false);
  });

  it('counts the models of a class and those a slot with a session left could serve; a full class has none free', () => {
    expect(classCountsOf(table, 'heavy', slots)).toEqual({ models: 2, free: 1 });
    const full = { ...table, now: { ...table.now, classes: [{ name: 'heavy', busy: 2, cap: 2 }] } } as ModelsReply;
    expect(classCountsOf(full, 'heavy', slots)).toEqual({ models: 2, free: 0 });
    expect(classCountsOf(null, 'heavy', [])).toEqual({ models: 0, free: 0 });
    expect(classCountsOf(table, 'heavy', [])).toEqual({ models: 2, free: 2 }); // no runner awake: nothing runs
  });
});
