import { describe, expect, it } from 'vitest';
import { usageSummary } from './run-summary';

describe('usageSummary — what the release note says a run used', () => {
  it('names tokens and leaves a zero cost out (flat plans report 0)', () => {
    expect(usageSummary({ tokensIn: 331_122, tokensOut: 1_511, costUsd: 0 })).toBe(' — 331k in / 2k out');
    expect(usageSummary({ tokensIn: 3_400_000, tokensOut: 800, costUsd: null })).toBe(' — 3.4M in / 800 out');
  });

  it('adds a real cost and stays silent when nothing was used', () => {
    expect(usageSummary({ tokensIn: 1_000, tokensOut: 10, costUsd: 0.124 })).toBe(' — 1k in / 10 out · $0.12');
    expect(usageSummary({ tokensIn: 0, tokensOut: 0, costUsd: null })).toBe('');
  });

  it('names the cached part of the input when the provider reported one (req-53)', () => {
    expect(usageSummary({ tokensIn: 6_565_245, tokensOut: 12_779, cacheReadTokens: 6_200_000, costUsd: 0 })).toBe(' — 6.6M in (6.2M cached) / 13k out');
    expect(usageSummary({ tokensIn: 1_000, tokensOut: 10, cacheReadTokens: 0, costUsd: null })).toBe(' — 1k in / 10 out');
  });
});
