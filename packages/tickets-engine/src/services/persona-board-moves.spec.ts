import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import type { TicketHold } from '../contracts/persona-board';
import type { TicketCard } from '../contracts/tickets';
import { crewLookupOf } from '../core/chain-holder';
import { parseChainItems } from '../core/chain-list';
import { personaMoveOf } from './persona-board-moves';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(line);
  }
  return [...parsed.entries];
}

const STANDARD = 'paul:shape; paul; ben; ralf; tessa; you';
const LOOKUP = crewLookupOf(new Map([['paul', 'agent'], ['ben', 'agent'], ['bob', 'agent'], ['ralf', 'agent'], ['tessa', 'agent'], ['you', 'human']] as const));

function card(phase: string, line: string | null, at: number | undefined, hold?: Partial<TicketHold>): TicketCard {
  const base: TicketHold = { holder: 'ben', why: 'entry', position: at ?? 1, length: 6, chain: [], mode: null, named: 'ben', claimed: false, sentBack: null, questions: 0 };
  return {
    id: 'T-0001',
    phase,
    meta: { ...(line === null ? {} : { chain: chain(line) }), ...(at === undefined ? {} : { at }) },
    ...(hold === undefined ? {} : { hold: { ...base, ...hold } }),
  } as unknown as TicketCard;
}

const FLOW = chain(STANDARD);

describe('starting a ticket on a persona', () => {
  it('makes it active and hands the entry at the cursor to the dropped-on persona', () => {
    expect(personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'paul' }, card: card('inbox', STANDARD, undefined), lookup: LOOKUP, flow: FLOW })).toEqual({
      kind: 'write', phase: 'active', chain: { entries: ['paul:shape', 'paul', 'ben', 'ralf', 'tessa', 'you'], at: 1 }, line: 'started at position 1 of 6 with paul',
    });
    const parked = personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'bob' }, card: card('prioritized', STANDARD, 3), lookup: LOOKUP, flow: FLOW });
    expect(parked).toMatchObject({ kind: 'write', phase: 'active', chain: { entries: ['paul:shape', 'paul', 'bob', 'ralf', 'tessa', 'you'], at: 3 } });
  });

  it('gives a chainless ticket the standard flow first, or that one persona', () => {
    expect(personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'ben' }, card: card('inbox', null, undefined), lookup: LOOKUP, flow: FLOW })).toMatchObject({ chain: { entries: ['ben:shape', 'paul', 'ben', 'ralf', 'tessa', 'you'], at: 1 } });
    expect(personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'ben' }, card: card('inbox', null, undefined), lookup: LOOKUP, flow: [] })).toMatchObject({ chain: { entries: ['ben'], at: 1 } });
  });

  it('refuses a ticket that is not in Inbox or Prioritized, and a persona not in the crew', () => {
    expect(personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'ben' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW }).kind).toBe('refused');
    expect(personaMoveOf({ move: { kind: 'start', id: 'T-0001', persona: 'ghost' }, card: card('inbox', STANDARD, 1), lookup: LOOKUP, flow: FLOW })).toEqual({ kind: 'refused', error: '"ghost" is not in the crew' });
  });
});

describe('handing a ticket to another persona', () => {
  it('reassigns the entry at the cursor; the mode and the rest stay', () => {
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'bob' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW })).toEqual({
      kind: 'write', phase: null, chain: { entries: ['paul:shape', 'paul', 'bob', 'ralf', 'tessa', 'you'], at: 3 }, line: 'position 3 of 6 handed to bob',
    });
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'ralf' }, card: card('building', STANDARD, 1, { holder: 'paul', named: 'paul', mode: 'shape' }), lookup: LOOKUP, flow: FLOW })).toMatchObject({ chain: { entries: ['ralf:shape', 'paul', 'ben', 'ralf', 'tessa', 'you'] } });
  });

  it('hands a ticket to You, and assigns one that stands at You for want of a persona', () => {
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'you' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW })).toMatchObject({ chain: { entries: ['paul:shape', 'paul', 'you', 'ralf', 'tessa', 'you'] } });
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'ben' }, card: card('building', 'paul; ghost; you', 2, { holder: 'you', why: 'no-persona', named: 'ghost' }), lookup: LOOKUP, flow: FLOW })).toMatchObject({ chain: { entries: ['paul', 'ben', 'you'], at: 2 } });
  });

  it('refuses while a run holds the claim or the owner owes an answer; a drop on its own holder does nothing', () => {
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'bob' }, card: card('building', STANDARD, 3, { claimed: true }), lookup: LOOKUP, flow: FLOW })).toEqual({ kind: 'refused', error: 'T-0001 is running at ben — stop the run first, then hand it on' });
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'bob' }, card: card('building', STANDARD, 3, { holder: 'you', why: 'question' }), lookup: LOOKUP, flow: FLOW }).kind).toBe('refused');
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'ben' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW })).toEqual({ kind: 'none' });
    expect(personaMoveOf({ move: { kind: 'hand', id: 'T-0001', persona: 'ben' }, card: card('inbox', STANDARD, 1), lookup: LOOKUP, flow: FLOW }).kind).toBe('refused');
  });
});

describe('parking a ticket', () => {
  it('moves it back to Prioritized or Inbox with its chain and cursor', () => {
    expect(personaMoveOf({ move: { kind: 'park', id: 'T-0001', stage: 'prioritized' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW })).toEqual({
      kind: 'write', phase: 'prioritized', chain: null, line: 'parked in Prioritized at position 3 of 6',
    });
    expect(personaMoveOf({ move: { kind: 'park', id: 'T-0001', stage: 'inbox' }, card: card('building', STANDARD, 3, {}), lookup: LOOKUP, flow: FLOW })).toMatchObject({ phase: 'inbox' });
  });

  it('refuses a running ticket', () => {
    expect(personaMoveOf({ move: { kind: 'park', id: 'T-0001', stage: 'prioritized' }, card: card('building', STANDARD, 3, { claimed: true }), lookup: LOOKUP, flow: FLOW }).kind).toBe('refused');
  });
});
