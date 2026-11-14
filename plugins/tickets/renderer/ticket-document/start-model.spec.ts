import { describe, expect, it } from 'vitest';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import { cardStartOf } from './start-model';

const LANES = [
  { persona: 'paul', title: 'Paul', kind: 'agent', color: '', parallel: null, min: 0 },
  { persona: 'ben', title: 'Ben', kind: 'agent', color: '', parallel: null, min: 0 },
  { persona: 'you', title: 'You', kind: 'human', color: '', parallel: null, min: 0 },
] as const;

const snap = (lanes: unknown = LANES): BoardSnapshot => ({ lanes }) as unknown as BoardSnapshot;
const card = (phase: string, meta: Record<string, unknown> = {}): TicketCard =>
  ({ id: 'T-0017', phase, meta: { chain: [{ persona: 'paul', mode: null, notify: false }, { persona: 'ben', mode: null, notify: false }], claimedBy: null, ...meta } }) as unknown as TicketCard;

describe("the card's Start (req-120)", () => {
  it('a Prioritized ticket on a persona board starts with the persona at its cursor', () => {
    expect(cardStartOf(snap(), card('prioritized'))).toEqual({ persona: 'paul', title: 'Paul' });
    expect(cardStartOf(snap(), card('prioritized', { at: 2 }))).toEqual({ persona: 'ben', title: 'Ben' });
  });

  it('shows nowhere else: the phase board, another stage, no chain, a persona not in the crew, a claimed ticket', () => {
    expect(cardStartOf({} as BoardSnapshot, card('prioritized'))).toBeNull();
    expect(cardStartOf(snap(), card('inbox'))).toBeNull();
    expect(cardStartOf(snap(), card('active'))).toBeNull();
    expect(cardStartOf(snap(), card('prioritized', { chain: [] }))).toBeNull();
    expect(cardStartOf(snap(), card('prioritized', { chain: [{ persona: 'bob', mode: null, notify: false }] }))).toBeNull();
    expect(cardStartOf(snap(), card('prioritized', { claimedBy: 'runner' }))).toBeNull();
  });
});
