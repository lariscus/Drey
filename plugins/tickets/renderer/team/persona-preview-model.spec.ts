import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../../../packages/tickets-engine/src/core/token-count';
import { atStartTokensOf, partLinesOf, previewRequestOf } from './persona-preview-model';
import type { PromptPreview } from './persona-seams';

const preview = (family: 'anthropic' | 'openai-compatible'): PromptPreview => ({
  ok: true,
  persona: 'ben',
  step: 'build',
  text: 'T',
  tokens: 1000,
  tokenizer: { id: family === 'anthropic' ? 'claude-estimate' : 'openai-estimate', family, exact: false, model: null },
  parts: [
    { name: 'instructions', tokens: 100 },
    { name: 'skills', tokens: 300 },
    { name: 'memory', tokens: 50 },
    { name: 'rest', tokens: 550 },
  ],
  skills: [],
});

describe('the figure at the start of a run (req-238)', () => {
  it('swaps the instructions’ share of the engine’s total for the draft’s, by the engine’s family rule', () => {
    expect(atStartTokensOf(preview('anthropic'), 'x'.repeat(350))).toBe(1000 - 100 + 100); // 350 / 3.5
    expect(atStartTokensOf(preview('openai-compatible'), 'x'.repeat(400))).toBe(1000 - 100 + 100); // 400 / 4
    expect(atStartTokensOf(preview('anthropic'), '  \n')).toBe(900);
  });

  it('equals the engine’s own total while the draft is the saved text', () => {
    const text = 'Calm and terse.';
    const own = { ...preview('anthropic'), parts: [{ name: 'instructions', tokens: estimateTokens(text, { family: 'anthropic' }) }] };
    expect(atStartTokensOf(own, text)).toBe(1000);
  });

  it('never goes below zero', () => {
    expect(atStartTokensOf({ ...preview('anthropic'), tokens: 10 }, '')).toBe(0);
  });
});

describe('the preview’s parts and request', () => {
  it('names the four parts the engine counts and passes an unknown part under its own name', () => {
    expect(partLinesOf(preview('anthropic')).map((line) => [line.name, line.key, line.tokens])).toEqual([
      ['instructions', 'persona.preview.part.instructions', 100],
      ['skills', 'persona.preview.part.skills', 300],
      ['memory', 'persona.preview.part.memory', 50],
      ['rest', 'persona.preview.part.rest', 550],
    ]);
    expect(partLinesOf({ ...preview('anthropic'), parts: [{ name: 'extra', tokens: 1 }] })[0]).toMatchObject({ key: null, name: 'extra' });
  });

  it('asks for the first step and the strongest model, and names only what exists', () => {
    expect(previewRequestOf(['plan', 'review'], 'claude-code/opus')).toEqual({ step: 'plan', model: 'claude-code/opus' });
    expect(previewRequestOf([], '')).toEqual({});
    expect(previewRequestOf(undefined, ' opus ')).toEqual({ model: 'opus' });
  });
});
