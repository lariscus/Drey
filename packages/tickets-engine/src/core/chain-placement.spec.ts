import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import { parseChainItems } from './chain-list';
import { chainColumnOf, chainFinished } from './chain-placement';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const STANDARD = chain('paul:shape; paul; ben; ralf; tessa; you');

describe('the column of a chain ticket on the persona board', () => {
  it('shows a finished chain in the terminal column', () => {
    expect(chainFinished(STANDARD, 7)).toBe(true);
    expect(chainFinished(STANDARD, 6)).toBe(false);
    expect(chainColumnOf({ chain: STANDARD, at: 7 }, 'done')).toBe('done');
  });

  it('has no pipeline column for a live chain — the stage draws its own column', () => {
    for (const at of [1, 3, 6]) {
      expect(chainColumnOf({ chain: STANDARD, at }, 'done')).toBeNull();
    }
    expect(chainColumnOf({ chain: undefined, at: undefined }, 'done')).toBeNull();
  });
});
