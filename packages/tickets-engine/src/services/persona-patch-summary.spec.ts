import { describe, expect, it } from 'vitest';
import { personaPatchPartsOf } from './persona-patch-summary';
import { humanPersona, parsePersonaFile } from '../core/persona/persona';

/**
 * The patchPersona card's summary parts (req-315): every sent field as
 * `field: old → new` against the record; unsent fields stay out; the
 * prompt's part is the chat service's (it reads the file).
 */

const BEN = parsePersonaFile(
  'ben',
  [
    '---',
    'title: Ben',
    'role: builder',
    'class: standard',
    "model: \"kimi/k2\"",
    "summary: \"Builds the plan\"",
    "color: '#aabbcc'",
    'skills: [review]',
    'budget: 5',
    'parallel: 2',
    'min: 1',
    'readonly: true',
    'leaving: [commit]',
    'allowed:',
    '  network: true',
    '---',
    '',
].join('\n'),
);

describe('personaPatchPartsOf', () => {
  it('one part per sent field, old against new — the fields in their fixed order', () => {
    const parts = personaPatchPartsOf(BEN, { budget: 10, class: 'heavy', model: null, skills: ['review', 'qa'] });
    expect(parts).toEqual(['class standard → heavy', 'model kimi/k2 → (the class decides)', 'budget $5 → $10', 'skills review → review, qa']);
  });

  it('null clears tell the truth about what a clear means', () => {
    expect(personaPatchPartsOf(BEN, { budget: null })).toEqual(['budget $5 → none']);
    expect(personaPatchPartsOf(BEN, { model: 'glm-5' })).toEqual(['model kimi/k2 → glm-5']);
  });

  it('chat model and rights and the run pool render their own labels', () => {
    const pia = parsePersonaFile('pia', '---\ntitle: Pia\nkind: mission\nrole: custom\nmodel: "glm-5"\n---\n');
    expect(personaPatchPartsOf(pia, { chatModel: null })).toEqual(["chat model glm-5 → (the assistant's)"]);
    const parts = personaPatchPartsOf(BEN, { allowed: { network: false, runCommands: 'bypass' }, settings: { parallel: null, readOnly: false, leaving: ['commit', 'sync-main'] } });
    expect(parts).toEqual([
      'run commands (the crew setting) → bypass',
      'network on → off',
      'max in parallel 2 → (unset)',
      'read-only on → off',
      'leaving commit → commit, sync-main',
    ]);
  });

  it('the owner persona shows their title change and nothing run-related', () => {
    const you = humanPersona('You');
    expect(personaPatchPartsOf(you, { title: 'Henrik' })).toEqual(['title “You” → “Henrik”']);
  });

  it('a long summary clips so the card stays one line', () => {
    const parts = personaPatchPartsOf(BEN, { summary: 'x'.repeat(120) });
    expect(parts[0]!.startsWith('summary “Builds the plan” → “xx')).toBe(true);
    expect(parts[0]!.length).toBeLessThan(80);
  });

  it('an empty patch renders no parts', () => {
    expect(personaPatchPartsOf(BEN, {})).toEqual([]);
  });
});
