import { describe, expect, it } from 'vitest';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol-slots';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { addableModelsOf, modelLinesOf, movedPool, tableRowOf } from './persona-work-model';

const row = (model: string, over: Record<string, unknown> = {}) => ({ model, slot: null, provider: 'claude-code', category: 'x', class: 'A', cost: 3, sessions: 2, ...over });
const table = { ok: true, models: [row('opus'), row('sonnet', { class: 'B', cost: 1 }), row('glm-5.3', { provider: 'opencode', class: 'C', cost: 0.2, slot: 'z' }), row('shared', { provider: 'kimi' }), row('shared', { provider: 'opencode' })] } as unknown as ModelsReply;
const slots = [
  { id: 'a', label: 'Claude A', provider: 'claude-code', busy: 1, total: 3 },
  { id: 'b', label: 'Claude B', provider: 'claude-code', busy: 0, total: 2 },
  { id: 'z', label: 'z.ai', provider: 'opencode', busy: 2, total: null },
] as unknown as SlotView[];

describe('modelLinesOf (R11): the persona models against the model table', () => {
  it('reads class, factor and the busy slots of the slots that serve the row', () => {
    const lines = modelLinesOf(['opus', 'glm-5.3'], 'claude-code', table, slots, i18n);
    expect(lines[0]).toMatchObject({ index: 1, model: 'opus', detail: 'Claude Code · class A · factor 3', busy: '1 / 5 busy' });
    expect(lines[1]).toMatchObject({ index: 2, model: 'glm-5.3', detail: 'z.ai · class C · factor 0.2', busy: '2 busy' });
  });

  it('says so for a model the table lacks and draws no busy figure', () => {
    expect(modelLinesOf(['ghost'], 'kimi', table, slots, i18n)[0]).toMatchObject({ detail: 'Kimi Code · not in the model table', busy: null });
    expect(modelLinesOf(['claude-code/opus'], 'kimi', null, [], i18n)[0]).toMatchObject({ model: 'opus', detail: 'Claude Code · not in the model table' });
  });

  it('finds a row by provider/model where the id alone is ambiguous', () => {
    expect(tableRowOf('kimi/shared', table)?.provider).toBe('kimi');
    expect(tableRowOf('nothing', table)).toBeNull();
  });
});

describe('what the pool can still take, and in which order', () => {
  it('offers the table models the pool does not hold, ambiguous ids as provider/model', () => {
    expect(addableModelsOf(['opus'], table)).toEqual(['sonnet', 'glm-5.3', 'kimi/shared', 'opencode/shared']);
    expect(addableModelsOf([], null)).toEqual([]);
  });

  it('moves one entry by one place and leaves the ends alone', () => {
    expect(movedPool(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedPool(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(movedPool(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(movedPool(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
