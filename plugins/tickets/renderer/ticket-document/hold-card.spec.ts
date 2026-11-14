import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- a spec builds the real catalog; the plugin itself gets it as `api.i18n`
import { i18n } from '../../../../shared/i18n';
import type { TicketHold } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import { holdCardOf, titleOfSnapshot } from './hold-card';

const LANES = [
  { persona: 'paul', title: 'Paul', kind: 'agent', color: '#a1b2c3', parallel: null, min: 0 },
  { persona: 'ben', title: 'Ben', kind: 'agent', color: '', parallel: null, min: 0 },
  { persona: 'ralf', title: 'Ralf', kind: 'agent', color: '', parallel: null, min: 0 },
  { persona: 'you', title: 'You', kind: 'human', color: '', parallel: null, min: 0 },
] as const;
const entry = (persona: string, mode: 'shape' | null = null) => ({ persona, mode, notify: false });

const snap = (extra: Record<string, unknown> = {}): BoardSnapshot =>
  ({ lanes: LANES, pipeline: [{ id: 'inbox' }, { id: 'prioritized' }, { id: 'active' }, { id: 'done' }], ...extra }) as unknown as BoardSnapshot;
const card = (phase: string, meta: Record<string, unknown> = {}, hold?: Partial<TicketHold>): TicketCard =>
  ({
    id: 'T-0121',
    phase,
    meta: { chain: [entry('paul', 'shape'), entry('paul'), entry('ben'), entry('ralf'), entry('you')], ...meta },
    ...(hold === undefined
      ? {}
      : {
          hold: {
            holder: 'ben',
            why: 'entry',
            position: 3,
            length: 5,
            chain: ['paul', 'paul', 'ben', 'ralf', 'you'],
            mode: null,
            named: 'ben',
            claimed: false,
            sentBack: null,
            questions: 0,
            ...hold,
          },
        }),
  }) as unknown as TicketCard;

const view = (s: BoardSnapshot, c: TicketCard) => holdCardOf(i18n, s, c, titleOfSnapshot(s, [{ id: 'tessa', title: 'Tessa T.' }]));
const flowWords = (s: BoardSnapshot, c: TicketCard) => view(s, c)!.flow.map((item) => [item.title, item.state, item.note]);

describe('the ticket card on a persona board (7a v2)', () => {
  it('a held ticket: done positions ticked, the cursor with its position, Holder the persona', () => {
    expect(flowWords(snap(), card('active', {}, {}))).toEqual([
      ['Paul', 'past', null],
      ['Paul', 'past', null],
      ['Ben', 'current', '(3 of 5)'],
      ['Ralf', 'future', null],
      ['You', 'future', null],
    ]);
    expect(view(snap(), card('active', {}, {}))!.holder).toEqual({ label: 'Ben', persona: 'ben', shape: false });
  });

  it('You holds a question in the words of the board: You · Ben asks', () => {
    expect(view(snap(), card('active', {}, { holder: 'you', why: 'question', named: 'ben' }))!.holder?.label).toBe('You · Ben asks');
    expect(view(snap(), card('active', {}, { holder: 'you', why: 'second-send-back' }))!.holder?.label).toBe('You · sent back twice');
    expect(view(snap(), card('active', {}, { holder: 'you', why: 'no-persona' }))!.holder?.label).toBe('You · no persona');
  });

  it('a Shape entry with an agent is the 7b picture', () => {
    expect(view(snap(), card('active', {}, { holder: 'paul', position: 1, mode: 'shape', named: 'paul' }))!.holder?.shape).toBe(true);
  });

  it('Inbox and Prioritized: no holder, the chain the ticket carries, else the standard flow', () => {
    expect(view(snap(), card('inbox'))!.holder).toBeNull();
    expect(flowWords(snap(), card('inbox')).map(([title]) => title)).toEqual(['Paul', 'Paul', 'Ben', 'Ralf', 'You']);
    const chainless = card('prioritized', { chain: undefined });
    expect(flowWords(snap({ flow: [entry('paul'), entry('tessa')] }), chainless)).toEqual([
      ['Paul', 'future', null],
      ['Tessa T.', 'future', null],
    ]);
    expect(flowWords(snap(), chainless)).toEqual([]);
  });

  it('Done: the chain walked', () => {
    expect(flowWords(snap(), card('done')).every(([, state]) => state === 'past')).toBe(true);
  });

  it('the phase board keeps its own card', () => {
    expect(view(snap({ lanes: undefined }), card('inbox'))).toBeNull();
  });
});
