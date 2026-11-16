import { describe, expect, it } from 'vitest';
import { chatPatchRefusalOf } from './persona-patch';
import { humanPersona, parsePersonaFile } from '../core/persona/persona';

/**
 * What a patchPersona card may change per persona kind (req-315): the agent
 * takes the page's set; the owner only their title, summary, instructions
 * and leaving actions; Mission Control's persona only her profile,
 * instructions, chat model and skills. Values are `personaPatchError`'s
 * business — this is the kind rule alone.
 */

const BEN = parsePersonaFile('ben', '---\ntitle: Ben\nrole: builder\nclass: standard\n---\n');
const YOU = humanPersona('You');
const PIA = parsePersonaFile('pia', '---\ntitle: Pia\nkind: mission\nrole: custom\n---\n');

describe('chatPatchRefusalOf', () => {
  it('an agent takes the whole page set', () => {
    expect(chatPatchRefusalOf(BEN, { budget: 3, allowed: { network: true }, settings: { parallel: 2 }, prompt: 'x' })).toBeNull();
  });

  it('the owner takes title, summary, prompt and leaving — nothing run-related', () => {
    expect(chatPatchRefusalOf(YOU, { title: 'Henrik' })).toBeNull();
    expect(chatPatchRefusalOf(YOU, { summary: 'The boss.' })).toBeNull();
    expect(chatPatchRefusalOf(YOU, { prompt: '# Me' })).toBeNull();
    expect(chatPatchRefusalOf(YOU, { settings: { leaving: ['commit'] } })).toBeNull();
    expect(chatPatchRefusalOf(YOU, { budget: 5 })).toContain("the owner's persona takes only");
    expect(chatPatchRefusalOf(YOU, { class: 'heavy' })).toContain("the owner's persona takes only");
    expect(chatPatchRefusalOf(YOU, { skills: [] })).toContain("the owner's persona takes only");
    expect(chatPatchRefusalOf(YOU, { allowed: { network: true } })).toContain("the owner's persona takes only");
    expect(chatPatchRefusalOf(YOU, { settings: { parallel: 2 } })).toContain("the owner's persona takes only");
    expect(chatPatchRefusalOf(YOU, { settings: { readOnly: true } })).toContain("the owner's persona takes only");
  });

  it('Mission Control takes her profile, instructions, chat model and skills', () => {
    expect(chatPatchRefusalOf(PIA, { chatModel: 'qwen3' })).toBeNull();
    expect(chatPatchRefusalOf(PIA, { skills: ['review'] })).toBeNull();
    expect(chatPatchRefusalOf(PIA, { prompt: '# Who Pia is' })).toBeNull();
    expect(chatPatchRefusalOf(PIA, { budget: 2 })).toContain("Mission Control's persona takes only");
    expect(chatPatchRefusalOf(PIA, { settings: { leaving: [] } })).toContain("Mission Control's persona takes only");
    expect(chatPatchRefusalOf(PIA, { class: 'light' })).toContain("Mission Control's persona takes only");
  });
});
