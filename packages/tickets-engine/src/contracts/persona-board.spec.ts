import { describe, expect, it } from 'vitest';
import {
  cardsByLane,
  chainCellsOf,
  holdBadgeOf,
  holdDotOf,
  holdStatusOf,
  laneLoadOf,
  parsePersonaBoardMove,
  type BoardLane,
  type HoldLive,
  type TicketHold,
} from './persona-board';
import type { BoardColumn, TicketCard } from './tickets';

const CHAIN = ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'];

function hold(patch: Partial<TicketHold> = {}): TicketHold {
  return { holder: 'ben', why: 'entry', position: 3, length: 6, chain: CHAIN, mode: null, named: 'ben', claimed: false, sentBack: null, questions: 0, ...patch };
}

const IDLE: HoldLive = { running: false, minutes: null, activity: null, queued: null, waitsFor: null, held: false };
const KINDS: Record<string, BoardLane['kind']> = { paul: 'agent', ben: 'agent', ralf: 'agent', tessa: 'agent', pia: 'mission', you: 'human' };
const kindOf = (id: string): BoardLane['kind'] | null => KINDS[id] ?? null;

describe('the chain cells of a card', () => {
  it('marks the positions before the cursor done, the cursor now, the rest next', () => {
    expect(chainCellsOf(hold()).map((cell) => cell.state)).toEqual(['done', 'done', 'now', 'next', 'next', 'next']);
  });

  it('marks the invalidated stretch after a send-back as running again', () => {
    expect(chainCellsOf(hold({ sentBack: { from: 5, to: 3 } })).map((cell) => cell.state)).toEqual(['done', 'done', 'now', 'again', 'again', 'next']);
    // once the cursor is past where the send-back came from, nothing runs again
    expect(chainCellsOf(hold({ position: 6, sentBack: { from: 5, to: 3 } })).map((cell) => cell.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'now']);
  });
});

describe("a card's badge", () => {
  it('names why the owner is asked, then Accept at You, then a send-back still running again', () => {
    expect(holdBadgeOf(hold({ holder: 'you', why: 'second-send-back' }))).toBe('sent-back-twice');
    expect(holdBadgeOf(hold({ holder: 'you', why: 'question' }))).toBe('question');
    expect(holdBadgeOf(hold({ holder: 'you', why: 'no-persona' }))).toBe('no-persona');
    expect(holdBadgeOf(hold({ holder: 'you', position: 6, named: 'you' }))).toBe('accept');
    expect(holdBadgeOf(hold({ sentBack: { from: 5, to: 3 } }))).toBe('sent-back-once');
    expect(holdBadgeOf(hold({ position: 6, holder: 'tessa', sentBack: { from: 5, to: 3 } }))).toBeNull();
    expect(holdBadgeOf(hold())).toBeNull();
  });
});

describe("a card's status", () => {
  it('reads the run first: merging main, running from the persona that sent it back, committing at You', () => {
    expect(holdStatusOf(hold(), { ...IDLE, running: true, activity: 'merging main' }, kindOf)).toEqual({ kind: 'merging-main' });
    expect(holdStatusOf(hold({ sentBack: { from: 5, to: 3 } }), { ...IDLE, running: true, minutes: 3 }, kindOf)).toEqual({ kind: 'running', minutes: 3, from: 'tessa' });
    expect(holdStatusOf(hold(), { ...IDLE, running: true, minutes: 6 }, kindOf)).toEqual({ kind: 'running', minutes: 6, from: null });
    expect(holdStatusOf(hold({ holder: 'you', named: 'you', position: 6 }), { ...IDLE, running: true }, kindOf)).toEqual({ kind: 'committing' });
  });

  it('says what waits on the owner at You', () => {
    expect(holdStatusOf(hold({ holder: 'you', why: 'question', questions: 1 }), IDLE, kindOf)).toEqual({ kind: 'asks', persona: 'ben', questions: 1 });
    expect(holdStatusOf(hold({ holder: 'you', why: 'second-send-back' }), IDLE, kindOf)).toEqual({ kind: 'decide' });
    expect(holdStatusOf(hold({ holder: 'you', why: 'no-persona', position: 4 }), IDLE, kindOf)).toEqual({ kind: 'no-persona', position: 4 });
    expect(holdStatusOf(hold({ holder: 'you', named: 'you', position: 6 }), IDLE, kindOf)).toEqual({ kind: 'ready' });
    expect(holdStatusOf(hold({ holder: 'you', named: 'you', position: 2 }), IDLE, kindOf)).toEqual({ kind: 'your-step' });
  });

  it('then the Shape chat, a Mission Control turn, a held persona, its own pool, the big pool', () => {
    expect(holdStatusOf(hold({ holder: 'paul', mode: 'shape', position: 1 }), IDLE, kindOf)).toEqual({ kind: 'shaping' });
    expect(holdStatusOf(hold({ holder: 'pia' }), IDLE, kindOf)).toEqual({ kind: 'mission-turn' });
    expect(holdStatusOf(hold(), { ...IDLE, held: true }, kindOf)).toEqual({ kind: 'held' });
    expect(holdStatusOf(hold(), { ...IDLE, waitsFor: 'ben' }, kindOf)).toEqual({ kind: 'waits-for', persona: 'ben' });
    expect(holdStatusOf(hold(), { ...IDLE, queued: 'waits for a B slot' }, kindOf)).toEqual({ kind: 'queued', line: 'waits for a B slot' });
    expect(holdStatusOf(hold(), IDLE, kindOf)).toEqual({ kind: 'waiting' });
  });

  it('draws a running, a waiting or a needs-you dot', () => {
    expect(holdDotOf({ kind: 'merging-main' })).toBe('run');
    expect(holdDotOf({ kind: 'queued', line: '' })).toBe('wait');
    expect(holdDotOf({ kind: 'shaping' })).toBe('need');
  });
});

describe("a column head's load", () => {
  const lane = (parallel: number | null, kind: BoardLane['kind'] = 'agent'): BoardLane => ({ persona: 'ben', title: 'Ben', kind, color: '', parallel, min: 0 });

  it('counts runs against the cap and what waits; You and Mission Control show none', () => {
    expect(laneLoadOf(lane(2), 2, 1)).toEqual({ running: 2, cap: 2, waiting: 1, atCap: true });
    expect(laneLoadOf(lane(null), 1, 0)).toEqual({ running: 1, cap: null, waiting: 0, atCap: false });
    expect(laneLoadOf(lane(null, 'human'), 0, 0)).toBeNull();
    expect(laneLoadOf(lane(null, 'mission'), 0, 0)).toBeNull();
  });
});

describe('the cards by lane', () => {
  it('groups the held cards by holder in board order and leaves the lifecycle cards out', () => {
    const card = (id: string, holder: string | null): TicketCard => ({ id, ...(holder === null ? {} : { hold: hold({ holder }) }) }) as unknown as TicketCard;
    const columns = [
      { phase: { id: 'inbox' }, tickets: [card('T-0001', null)] },
      { phase: { id: 'building' }, tickets: [card('T-0002', 'ben'), card('T-0003', 'you'), card('T-0004', 'ben')] },
    ] as unknown as BoardColumn[];
    const lanes = cardsByLane({ columns });
    expect(lanes.get('ben')?.map((c) => c.id)).toEqual(['T-0002', 'T-0004']);
    expect(lanes.get('you')?.map((c) => c.id)).toEqual(['T-0003']);
    expect(lanes.has('inbox')).toBe(false);
  });
});

describe('a persona board move payload', () => {
  it('reads start, hand and park and refuses anything else', () => {
    expect(parsePersonaBoardMove({ kind: 'start', id: 'T-0001', persona: 'ben' })).toEqual({ kind: 'start', id: 'T-0001', persona: 'ben' });
    expect(parsePersonaBoardMove({ kind: 'hand', id: 'T-0001', persona: 'you' })).toEqual({ kind: 'hand', id: 'T-0001', persona: 'you' });
    expect(parsePersonaBoardMove({ kind: 'park', id: 'T-0001', stage: 'prioritized' })).toEqual({ kind: 'park', id: 'T-0001', stage: 'prioritized' });
    expect(parsePersonaBoardMove({ kind: 'park', id: 'T-0001', stage: 'done' })).toBeNull();
    expect(parsePersonaBoardMove({ kind: 'hand', id: 'T-1', persona: 'ben' })).toBeNull();
    expect(parsePersonaBoardMove({ kind: 'hand', id: 'T-0001', persona: 'Ben!' })).toBeNull();
    expect(parsePersonaBoardMove(null)).toBeNull();
  });
});
