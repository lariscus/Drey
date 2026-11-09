import { describe, expect, it, vi } from 'vitest';
import { PersonaPreviewState } from './persona-preview-state';
import type { PreviewResult, PromptPreviewSeam } from './persona-seams';

const brief = (tokens: number): PreviewResult => ({
  ok: true,
  preview: { ok: true, persona: 'ben', step: 'build', text: 'T', tokens, tokenizer: { id: 'claude-estimate', family: 'anthropic', exact: false, model: null }, parts: [], skills: [] },
});

describe('PersonaPreviewState (req-238)', () => {
  it('asks again only when the step or the model changed, or when told to', async () => {
    const preview = vi.fn(async (): Promise<PreviewResult> => brief(1));
    let request: { step?: string; model?: string } = { step: 'build', model: 'opus' };
    const state = new PersonaPreviewState({ preview } as PromptPreviewSeam, 'ben', () => request);
    await state.ensure();
    await state.ensure();
    expect(preview).toHaveBeenCalledTimes(1);
    request = { step: 'build', model: 'sonnet' };
    await state.ensure();
    await state.ensure(true);
    expect(preview.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { step: 'build', model: 'opus' },
      { step: 'build', model: 'sonnet' },
      { step: 'build', model: 'sonnet' },
    ]);
  });

  it('keeps the failure of the last ask and the brief of the last one that worked', async () => {
    const answers: PreviewResult[] = [brief(5), { ok: false, code: 'no_persona', error: 'x' }, brief(6)];
    const state = new PersonaPreviewState({ preview: async () => answers.shift()! }, 'ben', () => ({}));
    await state.ensure(true);
    await state.ensure(true);
    expect(state.failure).toMatchObject({ code: 'no_persona' });
    expect(state.preview?.tokens).toBe(5);
    await state.ensure(true);
    expect(state.failure).toBeNull();
    expect(state.preview?.tokens).toBe(6);
  });

  it('drops an answer that arrives after a newer ask', async () => {
    const resolvers: ((value: PreviewResult) => void)[] = [];
    const state = new PersonaPreviewState({ preview: () => new Promise<PreviewResult>((resolve) => resolvers.push(resolve)) }, 'ben', () => ({}));
    const first = state.ensure(true);
    const second = state.ensure(true);
    resolvers[1]!(brief(2));
    resolvers[0]!(brief(1));
    await Promise.all([first, second]);
    expect(state.preview?.tokens).toBe(2);
  });

  it('tells its listeners when an answer lands', async () => {
    const state = new PersonaPreviewState({ preview: async () => brief(1) }, 'ben', () => ({}));
    const hear = vi.fn();
    state.subscribe(hear);
    await state.ensure();
    expect(hear).toHaveBeenCalledTimes(1);
  });
});
