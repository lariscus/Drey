import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../../contracts/chain';
import { parseChainEntry, parseChainItems, renderChainEntry } from './chain-list';
import { cursorAfterGreen, decideRedGate, redBackLine, redTargetPosition } from './chain-red-gate';
import { validateChain } from './chain-validate';
import { parseTicketChainFields } from '../ticket/ticket-chain-fields';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const CHAIN = 'paul:shape; paul; ben; ralf; tessa(on-red paul); you';

describe('req-78: the on-red option of a chain entry', () => {
  it('reads a persona or a position, with notify or alone, a colon tolerated', () => {
    expect(parseChainEntry('tessa(on-red paul)')).toEqual({ persona: 'tessa', mode: null, notify: false, onRed: 'paul' });
    expect(parseChainEntry('tessa(on-red 2)')).toEqual({ persona: 'tessa', mode: null, notify: false, onRed: 2 });
    expect(parseChainEntry('tessa (notify, on-red: paul)')).toEqual({ persona: 'tessa', mode: null, notify: true, onRed: 'paul' });
  });

  it('writes one canonical form', () => {
    expect(renderChainEntry(parseChainEntry('tessa(on-red: paul, notify)')!)).toBe('tessa(notify, on-red paul)');
    for (const raw of ['tessa(on-red paul)', 'tessa(notify, on-red 2)', 'ralf(notify)']) {
      expect(renderChainEntry(parseChainEntry(raw)!)).toBe(raw);
    }
  });

  it('refuses a doubled, empty or unknown option', () => {
    for (const raw of ['tessa(on-red)', 'tessa(on-red paul, on-red ben)', 'tessa(notify, notify)', 'tessa()', 'tessa(on-red 0)', 'tessa(on-red Paul)', 'tessa(red paul)']) {
      expect(parseChainEntry(raw)).toBeNull();
    }
  });
});

describe('req-78: where a red gate goes', () => {
  it('a persona names the nearest earlier position that holds it; a position must be earlier', () => {
    const entries = chain(CHAIN);
    expect(redTargetPosition(entries, 5, 'paul')).toBe(2);
    expect(redTargetPosition(entries, 5, 3)).toBe(3);
    expect(redTargetPosition(entries, 5, 5)).toBeNull();
    expect(redTargetPosition(entries, 5, 'you')).toBeNull();
    expect(redTargetPosition(entries, 2, 'ben')).toBeNull();
  });

  it('sends back with the count, stays without on-red, and stays past the bound', () => {
    const entries = chain(CHAIN);
    expect(decideRedGate({ chain: entries, at: 5, redBacks: 0, maxRed: 3 })).toEqual({ kind: 'back', from: 5, to: 2, redBacks: 1, maxRed: 3 });
    expect(decideRedGate({ chain: entries, at: 5, redBacks: 1, maxRed: 3 })).toEqual({ kind: 'back', from: 5, to: 2, redBacks: 2, maxRed: 3 });
    expect(decideRedGate({ chain: entries, at: 5, redBacks: 2, maxRed: 3 })).toEqual({ kind: 'bound', redBacks: 2, maxRed: 3 });
    expect(decideRedGate({ chain: entries, at: 4, redBacks: 0, maxRed: 3 })).toEqual({ kind: 'stay' });
    expect(decideRedGate({ chain: entries, at: 5, redBacks: 0, maxRed: 1 })).toEqual({ kind: 'bound', redBacks: 0, maxRed: 1 });
  });

  it('a target that names no earlier position (a replan moved it) stays and says why', () => {
    expect(decideRedGate({ chain: chain('ben; tessa(on-red paul)'), at: 2, redBacks: 0, maxRed: 3 })).toEqual({ kind: 'unresolved', reason: 'on-red paul names no earlier position of this chain' });
  });

  it('the line names both positions, the count and the gate', () => {
    const entries = chain(CHAIN);
    expect(redBackLine(entries, { kind: 'back', from: 5, to: 2, redBacks: 1, maxRed: 3 }, '`npm test` failed')).toBe(
      'red gate at position 5 (tessa) — sent back to 2 (paul) (red 1 of 2); returns to position 5 when position 2 is through: `npm test` failed',
    );
  });
});

describe('req-78: the return', () => {
  it('a green end goes straight back to return-to when it stands after the cursor, else on', () => {
    expect(cursorAfterGreen(6, 2, 5)).toEqual({ at: 5, returned: true });
    expect(cursorAfterGreen(6, 2, undefined)).toEqual({ at: 3, returned: false });
    expect(cursorAfterGreen(6, 5, 5)).toEqual({ at: 6, returned: false });
    expect(cursorAfterGreen(4, 2, 5)).toEqual({ at: 3, returned: false });
  });
});

describe('req-78: the guard and the fields', () => {
  it('refuses an on-red that names no earlier position, and a change of a past entry’s on-red', () => {
    const guard = { personas: ['paul', 'ben', 'ralf', 'tessa', 'you'], saved: [] as ChainEntry[], locked: 0 };
    expect(validateChain(chain(CHAIN), guard)).toBeNull();
    expect(validateChain(chain('paul; tessa(on-red ben); ben'), guard)).toBe('position 2: on-red ben names no earlier position of this chain — tessa(on-red ben)');
    const saved = chain('paul; tessa(on-red paul); you');
    expect(validateChain(chain('paul; tessa(on-red 1); you'), { ...guard, saved, locked: 3 })).toContain('position 2 (tessa(on-red paul)) is done');
    expect(validateChain(chain('paul; tessa; you'), { ...guard, saved, locked: 2 })).toBeNull(); // the current entry may change it
  });

  it('reads return-to and red-backs, warns on junk', () => {
    const issues: { level: string; message: string }[] = [];
    expect(parseTicketChainFields({ chain: CHAIN, at: 2, 'return-to': 5, 'red-backs': '1' }, issues as never, false)).toMatchObject({ at: 2, returnTo: 5, redBacks: 1 });
    expect(parseTicketChainFields({ chain: CHAIN, 'return-to': 'x' }, issues as never, false).returnTo).toBeUndefined();
    expect(issues.map((issue) => issue.message)).toEqual(['return-to must be a whole number from 1 — ignored']);
  });
});
