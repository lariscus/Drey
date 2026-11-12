import { describe, expect, it } from 'vitest';
import type { PersonaView } from '../../shared/remote-protocol';
import { EMPTY_PERSONA_SETTINGS } from '../../../../packages/tickets-engine/src/core/persona-settings';
import { budgetOf, draftOf, isDirty, isMissingFileError, patchOf, personaIdOfKey, personaKeyOf, personaPathsOf, savedBaseOf, wordsOf } from './persona-model';

const view: PersonaView = { id: 'ben', title: 'Ben', role: 'builder', worker: 'opencode', model: 'qwen3-coder', pool: ['qwen3-coder', 'sonnet'], color: '#8ecbef', budget: 5 };

describe('the persona tab key and paths', () => {
  it('round-trips the id and refuses another key', () => {
    expect(personaIdOfKey(personaKeyOf('ben'))).toBe('ben');
    expect(personaIdOfKey('board://all')).toBe('');
  });

  it('names the engine files, not the board sample', () => {
    expect(personaPathsOf('ben').persona).toBe('tickets/_meta/personas/ben/persona.md');
    expect(personaPathsOf('ben').prompt).toBe('tickets/_meta/personas/ben/prompt.md');
    expect(personaPathsOf('ben').personaShort).toBe('personas/ben/persona.md');
  });
});

describe('what a Save sends', () => {
  const base = draftOf(view, 'Prompt');

  it('shows the role as a label and falls back to the default model for an empty pool', () => {
    expect(base.role).toBe('Builder');
    expect(draftOf({ ...view, pool: [] }, '').pool).toEqual(['qwen3-coder']);
    expect(draftOf({ ...view, pool: [], model: '' }, '').pool).toEqual([]);
  });

  it('is empty for an untouched form, also with the role typed in another case', () => {
    expect(patchOf(base, base)).toEqual({});
    expect(isDirty(base, { ...base, role: ' builder ' })).toBe(false);
  });

  it('sends only the changed keys, the role as the engine word', () => {
    expect(patchOf(base, { ...base, role: 'Reviewer' })).toEqual({ role: 'reviewer' });
    expect(patchOf(base, { ...base, title: ' Benno ' })).toEqual({ title: 'Benno' });
    expect(patchOf(base, { ...base, prompt: 'New' })).toEqual({ prompt: 'New' });
    expect(patchOf(base, { ...base, pool: ['qwen3-coder', 'sonnet', 'opus'] })).toEqual({ pool: ['qwen3-coder', 'sonnet', 'opus'] });
    expect(Object.keys(base)).not.toContain('skills'); // a skill switch goes to the engine at once, not with Save
  });

  it('counts a reordered pool as a change: the order is the fallback order', () => {
    expect(patchOf(base, { ...base, pool: ['sonnet', 'qwen3-coder'] })).toEqual({ pool: ['sonnet', 'qwen3-coder'] });
  });

  it('keeps an emptied prompt: a prompt may be blanked on purpose', () => {
    expect(patchOf(base, { ...base, prompt: '' })).toEqual({ prompt: '' });
  });
});

describe('the run settings (req-258)', () => {
  const settings = { ...EMPTY_PERSONA_SETTINGS, minClass: 'B' as const, parallel: 2, leaving: ['sync-main' as const] };
  const recorded: PersonaView = { ...view, settings: { ...settings, readOnly: false }, readOnly: false };
  const base = draftOf(recorded, 'P');

  it('reads the class floor, read-only, the pool and the leaving actions off the record', () => {
    expect(base.settings).toEqual({ minClass: 'B', readOnly: false, readOnlyStored: true, parallel: '2', min: '0', leaving: ['sync-main'] });
    expect(draftOf(view, '').settings).toEqual({ minClass: '', readOnly: false, readOnlyStored: true, parallel: '', min: '0', leaving: [] });
  });

  it('sends only the settings that differ; a cleared floor and an emptied cap are null', () => {
    expect(patchOf(base, { ...base, settings: { ...base.settings, minClass: '' } })).toEqual({ settings: { minClass: null } });
    expect(patchOf(base, { ...base, settings: { ...base.settings, parallel: '' } })).toEqual({ settings: { parallel: null } });
    expect(patchOf(base, { ...base, settings: { ...base.settings, min: '1', leaving: [] } })).toEqual({ settings: { min: 1, leaving: [] } });
    expect(patchOf(base, { ...base, settings: { ...base.settings, readOnly: true } })).toEqual({ settings: { readOnly: true } });
    expect(patchOf(base, { ...base, settings: { ...base.settings, parallel: 'many', min: '-1' } })).toEqual({});
  });

  it("writes the role's read-only default into a record that lacks the key, once something else is saved", () => {
    const tester: PersonaView = { ...view, role: 'tester', settings: settings, readOnly: true };
    const fresh = draftOf(tester, 'P');
    expect(isDirty(fresh, fresh)).toBe(false);
    expect(patchOf(fresh, { ...fresh, title: 'Tess' })).toEqual({ title: 'Tess', settings: { readOnly: true } });
    expect(savedBaseOf({ ...fresh, title: 'Tess' }).settings.readOnlyStored).toBe(true);
  });
});

describe('small helpers', () => {
  it('counts words', () => {
    expect(wordsOf('')).toBe(0);
    expect(wordsOf('  one two\n three ')).toBe(3);
  });

  it('tells a missing file from a failed read', () => {
    expect(isMissingFileError(new Error("ENOENT: no such file or directory, open 'x'"))).toBe(true);
    expect(isMissingFileError(new Error('EISDIR: illegal operation on a directory'))).toBe(false);
  });
});

describe('the v2 fields (R11, req-171)', () => {
  const rich: PersonaView = { ...view, summary: 'Builds one part.', allowed: { spendAboveAllowance: false, writeVaults: ['notes'], runCommands: 'bypass', network: true } };
  const base = draftOf(rich, 'P');

  it('reads the one line, the harness, the budget and the allowed keys off the record', () => {
    expect(base.summary).toBe('Builds one part.');
    expect(base.worker).toBe('opencode');
    expect(base.budget).toBe('5');
    expect(base.allowed).toEqual({ writeVaults: ['notes'], runCommands: 'bypass', network: true, spend: false });
    expect(draftOf(view, '').allowed).toEqual({ writeVaults: [], runCommands: '', network: false, spend: false });
  });

  it('sends the one line, the harness and the budget only when they changed', () => {
    expect(patchOf(base, { ...base, summary: ' Builds. ' })).toEqual({ summary: 'Builds.' });
    expect(patchOf(base, { ...base, summary: '' })).toEqual({ summary: '' });
    expect(patchOf(base, { ...base, worker: 'claude-code' })).toEqual({ worker: 'claude-code' });
    expect(patchOf(base, { ...base, budget: '$7.50' })).toEqual({ budget: 7.5 });
    expect(patchOf(base, { ...base, budget: '' })).toEqual({ budget: null });
    expect(patchOf(base, { ...base, budget: '$5.00' })).toEqual({});
    expect(patchOf(base, { ...base, budget: 'lots' })).toEqual({});
  });

  it('sends only the allowed keys that differ; a cleared mode is null', () => {
    expect(patchOf(base, { ...base, allowed: { ...base.allowed, network: false } })).toEqual({ allowed: { network: false } });
    expect(patchOf(base, { ...base, allowed: { ...base.allowed, runCommands: '' } })).toEqual({ allowed: { runCommands: null } });
    expect(patchOf(base, { ...base, allowed: { ...base.allowed, spend: true, writeVaults: ['notes', 'work'] } })).toEqual({ allowed: { spendAboveAllowance: true, writeVaults: ['notes', 'work'] } });
    expect(isDirty(base, { ...base, allowed: { ...base.allowed } })).toBe(false);
  });

  it('reads a typed budget as dollars, none as null, nonsense as nothing to send', () => {
    expect([budgetOf('$12'), budgetOf(' 3.5 '), budgetOf(''), budgetOf('-1'), budgetOf('x')]).toEqual([12, 3.5, null, undefined, undefined]);
  });

  it('makes the saved form the new base', () => {
    expect(savedBaseOf({ ...base, title: ' Benno ', role: 'reviewer', summary: ' x ', worker: ' kimi ', budget: '$3' })).toMatchObject({ title: 'Benno', role: 'Reviewer', summary: 'x', worker: 'kimi', budget: '3' });
  });
});
