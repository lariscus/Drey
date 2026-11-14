import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import { runCursorOf } from './run-cursor';

const chain: readonly ChainEntry[] = [
  { persona: 'paul', mode: 'shape', notify: false },
  { persona: 'paul', mode: null, notify: false },
  { persona: 'ben', mode: null, notify: false },
];

describe('runCursorOf', () => {
  it('carries the proposal switch only while it is on (E10-5b)', () => {
    expect(runCursorOf({ chain, at: 2 })).toEqual({ at: 2, length: 3, entries: ['paul:shape', 'paul', 'ben'] });
    expect(runCursorOf({ chain, at: 2, proposeFlow: false })).not.toHaveProperty('proposeFlow');
    expect(runCursorOf({ chain, at: 2, proposeFlow: true })).toMatchObject({ at: 2, length: 3, proposeFlow: true });
  });

  it('keeps the cursor inside the chain', () => {
    expect(runCursorOf({ chain, at: 9 }).at).toBe(3);
    expect(runCursorOf({ chain, at: undefined }).at).toBe(1);
  });
});
