import { describe, expect, it } from 'vitest';
import { parsePersonaFile, personaFileText } from './persona';
import { EMPTY_PERSONA_SETTINGS, personaGate, personaReadOnly, personaRunSettingsOf } from './persona-settings';
import { settingsAfter, settingsPatchError } from '../contracts/persona-settings-patch';

const FULL = [
  '---',
  'title: Ben',
  'role: builder',
  'worker: claude-code',
  'models:',
  '  default: opus',
  '  pool: [opus]',
  "color: '#8ecbef'",
  'skills: []',
  'min-class: B',
  'needs: [image, context-200k]',
  'max-turns: 80',
  'max-work: 45',
  'gate: commands',
  'parallel: 2',
  'min: 1',
  'leaving: [sync-main]',
  'readonly: false',
  '---',
  '',
].join('\n');

describe('persona run settings (req-258)', () => {
  it('reads every key and writes them back byte for byte', () => {
    const persona = parsePersonaFile('ben', FULL);
    expect(persona.settings).toEqual({
      minClass: 'B',
      needs: { image: true, contextTokens: 200_000 },
      maxTurns: 80,
      maxWorkMin: 45,
      gate: 'commands',
      parallel: 2,
      min: 1,
      leaving: ['sync-main'],
      readOnly: false,
    });
    expect(personaFileText(persona)).toBe(FULL);
  });

  it('a record without them reads the defaults and stays byte-identical', () => {
    const text = FULL.split('\n').filter((line) => !/^(min-class|needs|max-turns|max-work|gate|parallel|min|leaving|readonly):/.test(line)).join('\n');
    const persona = parsePersonaFile('ben', text);
    expect(persona.settings).toEqual(EMPTY_PERSONA_SETTINGS);
    expect(personaFileText(persona)).toBe(text);
  });

  it('tolerates values of the wrong shape: they read as absent', () => {
    const persona = parsePersonaFile('ben', '---\nmin-class: Z\nmax-turns: -3\ngate: maybe\nparallel: 0\nmin: two\nleaving: [sync-main, dance]\nreadonly: yes\n---\n');
    expect(persona.settings).toEqual({ ...EMPTY_PERSONA_SETTINGS, leaving: ['sync-main'] });
  });

  it("the role's defaults fill what the record leaves out: reviewer and tester read only, the planner gates structurally", () => {
    const of = (role: string, over = {}) => ({ role, settings: { ...EMPTY_PERSONA_SETTINGS, ...over } });
    expect(personaReadOnly(of('reviewer'))).toBe(true);
    expect(personaReadOnly(of('tester'))).toBe(true);
    expect(personaReadOnly(of('builder'))).toBe(false);
    expect(personaReadOnly(of('tester', { readOnly: false }))).toBe(false);
    expect(personaReadOnly(of('custom', { readOnly: true }))).toBe(true);
    expect(personaGate(of('planner'))).toBe('structural');
    expect(personaGate(of('builder'))).toBe('commands');
    expect(personaGate(of('planner', { gate: 'commands' }))).toBe('commands');
    expect(personaRunSettingsOf(of('tester', { maxTurns: 9 }))).toEqual({ readOnly: true, gate: 'commands', maxTurns: 9, maxWorkMin: null, leaving: [] });
  });
});

describe('the settings patch', () => {
  it('replaces the sent keys and keeps the others; null clears a key', () => {
    const current = { ...EMPTY_PERSONA_SETTINGS, minClass: 'A' as const, parallel: 3, readOnly: true };
    expect(settingsAfter(current, { parallel: null, min: 2, leaving: ['commit', 'commit'], readOnly: null, needs: 'tools' })).toEqual({
      ...current,
      parallel: null,
      min: 2,
      leaving: ['commit'],
      readOnly: null,
      needs: { tools: true },
    });
  });

  it('refuses a value of the wrong kind, naming the key', () => {
    expect(settingsPatchError({ minClass: 'B', parallel: 2, readOnly: true, leaving: ['sync-main'] })).toBeNull();
    expect(settingsPatchError({ parallel: 0 })).toBe('settings.parallel has a value of the wrong kind');
    expect(settingsPatchError({ min: -1 })).toBe('settings.min has a value of the wrong kind');
    expect(settingsPatchError({ leaving: ['dance'] })).toBe('settings.leaving has a value of the wrong kind');
    expect(settingsPatchError({ needs: 'wings' })).toBe('settings.needs has a value of the wrong kind');
    expect(settingsPatchError([])).toBe('settings is an object');
  });
});
