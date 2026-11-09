import { describe, expect, it } from 'vitest';
import { kimiModeFor, kimiModesOf } from './kimi-modes';

/** req-183: a read-only start takes Kimi's `plan` mode when the session advertises it, else `auto` and a note. */
describe('kimiModeFor — the ACP mode for a start', () => {
  const advertised = kimiModesOf({ modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'plan' }, { id: 'auto' }, { id: 'yolo' }] } });

  it('reads the advertised mode ids, null when the result names none', () => {
    expect(advertised).toEqual(['default', 'plan', 'auto', 'yolo']);
    expect(kimiModesOf({ sessionId: 'ses_k' })).toBeNull();
    expect(kimiModesOf({ modes: { availableModes: 'plan' } })).toBeNull();
  });

  it('accept-edits is auto, bypass is yolo, as before', () => {
    expect(kimiModeFor('accept-edits', advertised)).toEqual({ modeId: 'auto', note: null });
    expect(kimiModeFor('bypass', null)).toEqual({ modeId: 'yolo', note: null });
  });

  it('read-only is plan when the session advertises it', () => {
    expect(kimiModeFor('read-only', advertised)).toEqual({ modeId: 'plan', note: null });
  });

  it('an older CLI without a plan mode keeps auto, and the stream says the disk is the only guard', () => {
    for (const modes of [null, ['default', 'auto', 'yolo']]) {
      const choice = kimiModeFor('read-only', modes);
      expect(choice.modeId).toBe('auto');
      expect(choice.note).toContain('no read-only mode');
    }
  });
});
