import { describe, expect, it } from 'vitest';
import { parseServiceSlots } from './slot-config';
import { slotAdded, slotRemoved } from './slot-edit';

/** One slot added or removed in `service.json` (D-69): the other entries stay as written, an implied slot is removed through `impliedOff`. */
describe('slot edits', () => {
  const kept = { id: 'claude-a', provider: 'claude-code', login: { claudeConfigDir: 'C:/a' }, limits: [{ window: '5h', budget: 9 }], custom: 'x' };

  it('appends an entry and keeps every other key and entry as written', () => {
    const edit = slotAdded({ slots: [kept], models: ['m'] }, { id: 'kimi-b', provider: 'kimi' });
    expect(edit).toEqual({ ok: true, root: { slots: [kept, { id: 'kimi-b', provider: 'kimi' }], models: ['m'] } });
  });

  it('refuses an entry that does not parse or whose id is taken', () => {
    expect(slotAdded({ slots: [kept] }, { id: 'claude-a', provider: 'claude-code' })).toEqual({ ok: false, error: 'slot "claude-a" is named twice' });
    expect(slotAdded({}, { id: 'x', provider: 'gemini' })).toMatchObject({ ok: false });
    expect(slotAdded({}, { id: '', provider: 'kimi' })).toMatchObject({ ok: false });
  });

  it('removes a configured entry by its id', () => {
    expect(slotRemoved({ slots: [kept, { id: 'b', provider: 'kimi' }] }, 'b')).toEqual({ ok: true, root: { slots: [kept] } });
  });

  it('removes an implied slot by naming its provider in impliedOff; the parse then leaves it out', () => {
    const edit = slotRemoved({ slots: [] }, 'copilot');
    expect(edit).toEqual({ ok: true, root: { slots: [], impliedOff: ['copilot'] } });
    expect(parseServiceSlots(edit.ok ? edit.root : {}).slots.map((s) => s.id)).toEqual(['opencode', 'claude-code', 'kimi']);
  });

  it('takes a provider off impliedOff when a slot is added for it', () => {
    expect(slotAdded({ slots: [], impliedOff: ['kimi', 'copilot'] }, { id: 'k', provider: 'kimi' })).toEqual({ ok: true, root: { slots: [{ id: 'k', provider: 'kimi' }], impliedOff: ['copilot'] } });
    expect(slotAdded({ impliedOff: ['kimi'] }, { id: 'k', provider: 'kimi' })).toEqual({ ok: true, root: { slots: [{ id: 'k', provider: 'kimi' }] } });
  });

  it('refuses to remove a slot a model row names', () => {
    expect(slotRemoved({ slots: [kept], models: [{ model: 'opus', slot: 'claude-a' }, { model: 'qwen', provider: 'opencode' }] }, 'claude-a')).toEqual({
      ok: false,
      error: 'slot "claude-a" runs opus in the model table: move or remove those rows first',
    });
  });

  it('refuses an id that names no slot', () => {
    expect(slotRemoved({ slots: [kept] }, 'nope')).toEqual({ ok: false, error: 'unknown slot "nope"' });
  });
});
