import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import { advanceCursor, atLastEntry, decideSendBack, invalidationLine, ownerSendBackTarget } from './chain-cursor';
import { parseChainItems } from './chain-list';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const STANDARD = chain('paul:shape; paul; ben; ralf; tessa; you');

describe('the cursor after a green end', () => {
  it('moves to the next position, and past the last entry the chain is finished', () => {
    expect(advanceCursor(STANDARD, 3)).toEqual({ kind: 'next', at: 4 });
    expect(advanceCursor(STANDARD, undefined)).toEqual({ kind: 'next', at: 2 });
    expect(advanceCursor(STANDARD, 6)).toEqual({ kind: 'finished' });
    expect(advanceCursor(STANDARD, 11)).toEqual({ kind: 'finished' });
  });

  it('knows the last entry — the sign-off position', () => {
    expect(atLastEntry(STANDARD, 6)).toBe(true);
    expect(atLastEntry(STANDARD, 5)).toBe(false);
    expect(atLastEntry([], 1)).toBe(false);
  });
});

describe('a persona send-back (concept §4)', () => {
  it('the first one moves the cursor back and invalidates the target and every later entry', () => {
    expect(decideSendBack({ chain: STANDARD, at: 5, sentBack: undefined, target: 3 })).toEqual({
      kind: 'moved',
      at: 3,
      sentBack: { from: 5, to: 3 },
      invalidated: [3, 4, 5, 6],
    });
  });

  it('may go all the way back to planning', () => {
    expect(decideSendBack({ chain: STANDARD, at: 5, sentBack: undefined, target: 1 })).toMatchObject({ kind: 'moved', at: 1, sentBack: { from: 5, to: 1 } });
  });

  it('a second one does not move the cursor: it goes to You with the earlier one', () => {
    expect(decideSendBack({ chain: STANDARD, at: 4, sentBack: { from: 5, to: 3 }, target: 3 })).toEqual({ kind: 'to-owner', earlier: { from: 5, to: 3 } });
  });

  it('refuses anything but an earlier position — before the one-send-back rule is asked', () => {
    expect(decideSendBack({ chain: STANDARD, at: 4, sentBack: undefined, target: 4 })).toEqual({
      kind: 'refused',
      reason: 'send-back to position 4 is not an earlier position of this chain (1–3)',
    });
    expect(decideSendBack({ chain: STANDARD, at: 4, sentBack: { from: 5, to: 3 }, target: 9 }).kind).toBe('refused');
    expect(decideSendBack({ chain: STANDARD, at: 2, sentBack: undefined, target: 0 })).toEqual({
      kind: 'refused',
      reason: 'send-back to position 0 is not an earlier position of this chain (1)',
    });
    expect(decideSendBack({ chain: STANDARD, at: 1, sentBack: undefined, target: 1 })).toEqual({
      kind: 'refused',
      reason: 'send-back to position 1 is not an earlier position of this chain — there is none',
    });
  });

  it('writes the status log line of the invalidation', () => {
    expect(invalidationLine(STANDARD, { from: 5, to: 3 }, ' the login test fails ')).toBe(
      'sent back 5>3 — from 5 (tessa) to 3 (ben): the login test fails; positions 3–6 run again',
    );
    expect(invalidationLine(chain('ben; ralf'), { from: 2, to: 1 }, '')).toBe('sent back 2>1 — from 2 (ralf) to 1 (ben); positions 1–2 run again');
  });
});

describe("the owner's Send back at You", () => {
  const agents = new Set(['paul', 'ben', 'ralf', 'tessa']);
  it('goes to the nearest earlier agent entry', () => {
    expect(ownerSendBackTarget(STANDARD, 6, (p) => agents.has(p))).toBe(5);
    expect(ownerSendBackTarget(chain('ben; you; pia; you'), 4, (p) => agents.has(p))).toBe(1);
  });

  it('has nowhere to go without an earlier agent entry', () => {
    expect(ownerSendBackTarget(chain('pia; you'), 2, (p) => agents.has(p))).toBeNull();
  });
});
