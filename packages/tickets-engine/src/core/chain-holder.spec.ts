import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import { entryAtCursor, holderOf, holderPersonaOf, noPersonaReason, type PersonaLookup } from './chain-holder';
import { parseChainItems } from './chain-list';
import type { PersonaKind } from './persona';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const CREW: Record<string, PersonaKind> = { pia: 'mission', paul: 'agent', ben: 'agent', ralf: 'agent', tessa: 'agent', you: 'human' };
const lookup: PersonaLookup = (id) => (CREW[id] === undefined ? null : { id, kind: CREW[id]! });
const STANDARD = chain('paul:shape; paul; ben; ralf; tessa; you');

describe('the holder rule (concept §3)', () => {
  it('rule 1: a lifecycle edge has no holder', () => {
    for (const stage of ['inbox', 'prioritized', 'done', 'cancelled']) {
      expect(holderOf({ stage, chain: STANDARD, at: 3, awaiting: undefined }, lookup)).toEqual({ kind: 'none' });
    }
  });

  it('rule 2: awaiting you puts the ticket at You, naming the entry it waits at', () => {
    const holder = holderOf({ stage: 'active', chain: STANDARD, at: 3, awaiting: 'you' }, lookup);
    expect(holder).toEqual({ kind: 'awaiting', persona: 'you', entry: { position: 3, length: 6, named: 'ben', mode: null, notify: false } });
    expect(holderPersonaOf(holder)).toBe('you');
  });

  it('rule 3: an entry naming no readable persona stands at You with the reason', () => {
    const holder = holderOf({ stage: 'active', chain: chain('paul; bob; you'), at: 2, awaiting: undefined }, lookup);
    expect(holder.kind).toBe('no-persona');
    expect(holder.kind === 'no-persona' ? holder.reason : '').toBe('no persona for position 2 ("bob" is not in the crew)');
    expect(holderPersonaOf(holder)).toBe('you');
  });

  it('rule 3: a ticket without a chain stands at You too', () => {
    const holder = holderOf({ stage: 'active', chain: undefined, at: undefined, awaiting: undefined }, lookup);
    expect(holder).toEqual({ kind: 'no-persona', persona: 'you', entry: null, reason: 'the ticket has no chain — no persona to take it' });
  });

  it('rule 4: the entry persona holds it, with what happens there', () => {
    const at = (n: number) => holderOf({ stage: 'running', chain: chain('pia; paul:shape; ben(notify); you'), at: n, awaiting: undefined }, lookup);
    expect(at(1)).toMatchObject({ kind: 'entry', persona: 'pia', work: 'mission-turn' });
    expect(at(2)).toMatchObject({ kind: 'entry', persona: 'paul', work: 'run', entry: { mode: 'shape' } });
    expect(at(3)).toMatchObject({ kind: 'entry', persona: 'ben', work: 'run', entry: { notify: true } });
    expect(at(4)).toMatchObject({ kind: 'entry', persona: 'you', work: 'owner', entry: { position: 4, length: 4 } });
  });

  it('the same persona twice: the position, not the id, is what the cursor points at', () => {
    const second = holderOf({ stage: 'active', chain: chain('paul; ben; paul; you'), at: 3, awaiting: undefined }, lookup);
    expect(second).toMatchObject({ kind: 'entry', persona: 'paul', entry: { position: 3 } });
  });
});

describe('the entry at the cursor', () => {
  it('reads an absent cursor as 1 and clamps one past the chain to its last entry', () => {
    expect(entryAtCursor(STANDARD, undefined)?.position).toBe(1);
    expect(entryAtCursor(STANDARD, 9)?.position).toBe(6);
    expect(entryAtCursor([], 1)).toBeNull();
  });

  it('says why nobody holds a chainless ticket', () => {
    expect(noPersonaReason(null)).toContain('no chain');
    expect(noPersonaReason({ position: 4, length: 6, named: null, mode: null, notify: false })).toBe('no persona for position 4');
  });
});
