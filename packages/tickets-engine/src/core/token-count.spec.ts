import { describe, expect, it } from 'vitest';
import { estimateTokens, tokenizerFor } from './token-count';

describe('tokenizerFor', () => {
  it('counts the Claude Code worker and any Claude model id with the Anthropic estimate', () => {
    expect(tokenizerFor('claude-code', 'opus')).toEqual({ id: 'claude-estimate', family: 'anthropic', exact: false, model: 'opus' });
    expect(tokenizerFor('opencode', 'claude-sonnet-5-5').family).toBe('anthropic');
    expect(tokenizerFor(null, 'anthropic/claude-opus-5-5').family).toBe('anthropic');
  });

  it('counts every other worker and model with the OpenAI-compatible estimate', () => {
    expect(tokenizerFor('opencode', 'qwen3-coder')).toEqual({ id: 'openai-estimate', family: 'openai-compatible', exact: false, model: 'qwen3-coder' });
    expect(tokenizerFor('kimi', null).family).toBe('openai-compatible');
    expect(tokenizerFor(null, null).exact).toBe(false);
  });
});

describe('estimateTokens', () => {
  const anthropic = { family: 'anthropic' } as const;
  const openai = { family: 'openai-compatible' } as const;

  it('is 0 for nothing and at least 1 for anything', () => {
    expect(estimateTokens('', anthropic)).toBe(0);
    expect(estimateTokens('a', openai)).toBe(1);
  });

  it('divides ASCII by the family rate: 3.5 characters per token for Anthropic, 4 for the others', () => {
    expect(estimateTokens('x'.repeat(350), anthropic)).toBe(100);
    expect(estimateTokens('x'.repeat(400), openai)).toBe(100);
    expect(estimateTokens('x'.repeat(351), anthropic)).toBe(101);
  });

  it('counts a character outside ASCII as three quarters of a token', () => {
    expect(estimateTokens('日本語日本語日本語日本語', openai)).toBe(9);
    expect(estimateTokens('ä'.repeat(4), anthropic)).toBe(3);
  });
});
