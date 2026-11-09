import { describe, expect, it, vi } from 'vitest';
import { enginePromptPreviewSeam, engineSkillsSeam } from './persona-seams';

const LIST = { persona: 'ben', skills: [], missing: [], selectedTokens: 0, tokenizer: { id: 'claude-estimate', family: 'anthropic', exact: false, model: null } };

describe('the skills seam over the plugin IPC (req-237)', () => {
  it('sends each call to its route with the payload the main-process handler reads and unwraps the listing', async () => {
    const invoke = vi.fn(async (method: string) => (method === 'skillUpload' ? { ok: true, name: 'review', origin: 'own', files: 2, replaced: false, list: LIST } : { ok: true, list: LIST }));
    const seam = engineSkillsSeam(invoke);
    expect(await seam.list('ben')).toEqual({ ok: true, list: LIST });
    await seam.toggle('ben', 'tdd', true);
    await seam.remove('ben', 'tdd');
    expect(await seam.upload({ scope: 'own', persona: 'ben', format: 'markdown', text: 'x' })).toEqual({ ok: true, name: 'review', replaced: false, list: LIST });
    expect(invoke.mock.calls).toEqual([
      ['personaSkills', { persona: 'ben' }],
      ['personaSkillToggle', { persona: 'ben', skill: 'tdd', on: true }],
      ['personaSkillRemove', { persona: 'ben', name: 'tdd' }],
      ['skillUpload', { scope: 'own', persona: 'ben', format: 'markdown', text: 'x' }],
    ]);
  });

  it('keeps the engine’s code on a refusal, drops a code it does not know, and turns a thrown call into a failure', async () => {
    expect(await engineSkillsSeam(async () => ({ ok: false, code: 'exists', error: 'a skill named x exists' })).upload({ scope: 'own', format: 'zip' })).toEqual({ ok: false, code: 'exists', error: 'a skill named x exists' });
    expect(await engineSkillsSeam(async () => ({ ok: false, code: 'brand_new', error: 'new' })).list('ben')).toEqual({ ok: false, code: null, error: 'new' });
    expect(await engineSkillsSeam(async () => null).list('ben')).toEqual({ ok: false, code: 'internal', error: '' });
    expect(
      await engineSkillsSeam(async () => {
        throw new TypeError('fetch failed');
      }).list('ben'),
    ).toEqual({ ok: false, code: null, error: 'fetch failed' });
  });
});

describe('the prompt preview seam (req-238)', () => {
  it('asks personaPromptPreview with the step and model and returns the brief', async () => {
    const reply = { ok: true, persona: 'ben', step: 'build', text: 'T', tokens: 10, tokenizer: LIST.tokenizer, parts: [], skills: [] };
    const invoke = vi.fn(async () => reply);
    expect(await enginePromptPreviewSeam(invoke).preview('ben', { step: 'plan', model: 'opus' })).toEqual({ ok: true, preview: reply });
    expect(invoke).toHaveBeenCalledWith('personaPromptPreview', { persona: 'ben', step: 'plan', model: 'opus' });
    expect(await enginePromptPreviewSeam(async () => ({ ok: false, code: 'no_persona', error: 'x' })).preview('ghost', {})).toEqual({ ok: false, code: 'no_persona', error: 'x' });
  });
});
