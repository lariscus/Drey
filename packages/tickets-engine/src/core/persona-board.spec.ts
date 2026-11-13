import { describe, expect, it } from 'vitest';
import type { BoardSnapshot, TicketCard } from '../contracts/tickets';
import { crewLookupOf } from './chain-holder';
import { parseChainItems } from './chain-list';
import { lanesOf, withPersonaBoard } from './persona-board';
import { EMPTY_PERSONA_SETTINGS } from './persona-settings';

function card(id: string, phase: string, line: string | null, patch: Record<string, unknown> = {}): TicketCard {
  const parsed = line === null ? null : parseChainItems(line.split(';'));
  const chain = parsed !== null && parsed.ok ? parsed.entries : undefined;
  return { id, phase, meta: { chain, at: 1, claimedBy: null, ...patch } } as unknown as TicketCard;
}

const STANDARD = 'paul:shape; paul; ben; ralf; tessa; you';
const LOOKUP = crewLookupOf(new Map([['paul', 'agent'], ['ben', 'agent'], ['ralf', 'agent'], ['tessa', 'agent'], ['you', 'human']] as const));

function snap(columns: readonly { id: string; tickets: TicketCard[] }[], openStatus: BoardSnapshot['openStatus'] = []): BoardSnapshot {
  return { columns: columns.map((c) => ({ phase: { id: c.id }, tickets: c.tickets, unknown: false })), openStatus, issues: [] } as unknown as BoardSnapshot;
}

describe('the lanes of a crew', () => {
  const persona = (id: string, kind: 'agent' | 'human' | 'mission', parallel: number | null = null) => ({ id, kind, title: id === 'you' ? 'You' : id.toUpperCase(), color: '#8ecbef', settings: { ...EMPTY_PERSONA_SETTINGS, parallel, min: 1 } });

  it('keeps the crew order and the agents’ own pools; You and Mission Control carry none', () => {
    const lanes = lanesOf([persona('pia', 'mission'), persona('ben', 'agent', 2), persona('you', 'human')]);
    expect(lanes.map((lane) => [lane.persona, lane.kind, lane.parallel, lane.min])).toEqual([
      ['pia', 'mission', null, 0],
      ['ben', 'agent', 2, 1],
      ['you', 'human', null, 0],
    ]);
  });

  it('adds You last when the crew has no human record', () => {
    expect(lanesOf([persona('ben', 'agent')]).map((lane) => lane.persona)).toEqual(['ben', 'you']);
  });
});

describe('the persona board of a snapshot', () => {
  it('holds every active card by its entry and leaves the lifecycle columns alone', () => {
    const board = withPersonaBoard(
      snap([
        { id: 'inbox', tickets: [card('T-0001', 'inbox', STANDARD)] },
        { id: 'building', tickets: [card('T-0002', 'building', STANDARD, { at: 3, claimedBy: 'agent-1@pc' })] },
        { id: 'done', tickets: [card('T-0003', 'done', STANDARD, { at: 7 })] },
      ]),
      [],
      LOOKUP,
    );
    expect(board.lanes).toEqual([]);
    expect(board.columns[0]!.tickets[0]!.hold).toBeUndefined();
    expect(board.columns[2]!.tickets[0]!.hold).toBeUndefined();
    expect(board.columns[1]!.tickets[0]!.hold).toEqual({
      holder: 'ben', why: 'entry', position: 3, length: 6, chain: ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'], mode: null, named: 'ben', claimed: true, sentBack: null, questions: 0,
    });
  });

  it('puts a question, a second send-back and a missing persona at You', () => {
    const board = withPersonaBoard(
      snap(
        [
          {
            id: 'building',
            tickets: [
              card('T-0004', 'building', STANDARD, { at: 3, awaiting: 'you' }),
              card('T-0005', 'building', STANDARD, { at: 4, awaiting: 'you', sentBack: { from: 5, to: 3 } }),
              card('T-0006', 'building', 'paul; ghost; you', { at: 2 }),
            ],
          },
          { id: 'done', tickets: [] },
        ],
        [
          { ticketId: 'T-0004', verb: 'needs-decision', key: 'q1', text: '?', since: '' },
          { ticketId: 'T-0005', verb: 'needs-decision', key: 'second-send-back', text: '', since: '' },
        ],
      ),
      [],
      LOOKUP,
    );
    const holds = board.columns[0]!.tickets.map((c) => c.hold);
    expect(holds.map((h) => [h?.holder, h?.why, h?.named, h?.questions])).toEqual([
      ['you', 'question', 'ben', 1],
      ['you', 'second-send-back', 'ralf', 0],
      ['you', 'no-persona', 'ghost', 0],
    ]);
    expect(holds[1]?.sentBack).toEqual({ from: 5, to: 3 });
  });

  it('holds the tickets of the stage column a lifecycle-only pipeline leaves them in, without the drift warning', () => {
    const base = snap([
      { id: 'inbox', tickets: [] },
      { id: 'done', tickets: [] },
    ]);
    const withActive = {
      ...base,
      columns: [...base.columns, { phase: { id: 'active' }, tickets: [card('T-0008', 'active', STANDARD, { at: 3 })], unknown: true }],
      issues: [{ level: 'warning', message: 'directory "active" is not a phase in pipeline.md' }, { level: 'warning', message: 'directory "odd" is not a phase in pipeline.md' }],
    } as unknown as BoardSnapshot;
    const board = withPersonaBoard(withActive, [], LOOKUP);
    expect(board.columns[2]!.tickets[0]!.hold?.holder).toBe('ben');
    expect(board.issues.map((issue) => issue.message)).toEqual(['directory "odd" is not a phase in pipeline.md']);
  });

  it('marks the Shape entry', () => {
    const board = withPersonaBoard(snap([{ id: 'active', tickets: [card('T-0007', 'active', STANDARD)] }, { id: 'done', tickets: [] }]), [], LOOKUP);
    expect(board.columns[0]!.tickets[0]!.hold?.mode).toBe('shape');
    expect(board.columns[0]!.tickets[0]!.hold?.holder).toBe('paul');
  });
});
