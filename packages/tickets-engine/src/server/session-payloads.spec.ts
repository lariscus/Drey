import { describe, expect, it } from 'vitest';
import { validateChatCommand } from '../core/chat-intents';
import { parseCrewPatches, parseFreeSessionAsk } from './session-payloads';

describe('the req-173 invoke payloads', () => {
  it('crew patches: known keys only; a patch without a value removes the key', () => {
    expect(parseCrewPatches([{ key: 'defaultWorker', value: 'kimi' }, { key: 'nope', value: 1 }, { key: 'tranche.runs', value: null }, { key: 'caps.diffStatLines' }, { key: 'defaultPersona', value: {} }])).toEqual([
      { key: 'defaultWorker', value: 'kimi' },
      { key: 'tranche.runs', value: null },
      { key: 'caps.diffStatLines', value: undefined },
    ]);
    expect(parseCrewPatches({ patches: [{ key: 'permissionMode', value: 'bypass' }] })).toEqual([{ key: 'permissionMode', value: 'bypass' }]);
    expect(parseCrewPatches('x')).toEqual([]);
  });

  it('a session ask: persona and directory required, class and permission checked, origin defaulted', () => {
    expect(parseFreeSessionAsk({ persona: ' ben ', directory: 'E:\\T', poolClass: 'B', permissionMode: 'read-only', firstLine: ' go ', origin: 'service-window' })).toEqual({
      ok: true,
      value: { persona: 'ben', directory: 'E:\\T', poolClass: 'B', permissionMode: 'read-only', firstLine: 'go' },
      origin: 'service-window',
    });
    expect(parseFreeSessionAsk({ persona: 'ben', directory: 'E:\\T' })).toMatchObject({ ok: true, origin: 'drey' });
    // req-283: the project picked rides the ask; a blank one is none.
    expect(parseFreeSessionAsk({ persona: 'ben', directory: 'E:\\T', project: ' drey ' })).toMatchObject({ ok: true, value: { project: 'drey' } });
    expect(parseFreeSessionAsk({ persona: 'ben', directory: 'E:\\T', project: ' ' })).toEqual({ ok: true, value: { persona: 'ben', directory: 'E:\\T' }, origin: 'drey' });
    expect(parseFreeSessionAsk({ persona: 'ben' })).toMatchObject({ ok: false });
    expect(parseFreeSessionAsk({ persona: 'ben', directory: 'E:\\T', poolClass: 'Z' })).toMatchObject({ ok: false });
    expect(parseFreeSessionAsk({ persona: 'ben', directory: 'E:\\T', permissionMode: 'yolo' })).toMatchObject({ ok: false });
  });

  it("Pia's startSession card: a persona id, a folder, a first line; a bad class refuses", () => {
    expect(validateChatCommand({ kind: 'startSession', persona: 'ben', directory: 'E:/projects/drey', poolClass: null, brief: 'Look at the build.' })).toEqual({
      kind: 'startSession',
      persona: 'ben',
      directory: 'E:/projects/drey',
      poolClass: null,
      brief: 'Look at the build.',
    });
    expect(validateChatCommand({ kind: 'startSession', persona: 'Ben!', directory: 'E:/x', brief: 'x' })).toBeNull();
    expect(validateChatCommand({ kind: 'startSession', persona: 'ben', directory: 'E:/x', poolClass: 'Z', brief: 'x' })).toBeNull();
    expect(validateChatCommand({ kind: 'startSession', persona: 'ben', directory: 'E:/x' })).toBeNull();
  });
});
