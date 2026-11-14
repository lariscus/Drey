import { describe, expect, it } from 'vitest';
import type { McVerlaufEntry } from '../api/dto';
import { McI18n } from '../i18n/i18n.service';
import type { McHold, McLane } from '../work/hold';
import type { McBoard } from '../work/work.model';
import {
  chainModesOf,
  defaultTargetOf,
  holdFlowOf,
  holdTargetsOf,
  holdTitleOf,
  positionCostViewOf,
  positionCostsOf,
  positionOfRun,
  roleWordOf,
  ticketHoldOf,
} from './hold-face';

const i18n = new McI18n();
const t = i18n.t.bind(i18n);

const LANES: readonly McLane[] = [
  { persona: 'paul', title: 'Paul', kind: 'agent', color: '#f3c1d3', parallel: 1, min: 0 },
  { persona: 'ben', title: 'Ben', kind: 'agent', color: '#9fd0f0', parallel: 2, min: 0 },
  { persona: 'ralf', title: 'Ralf', kind: 'agent', color: '#c9b6f2', parallel: 1, min: 0 },
  { persona: 'tessa', title: 'Tessa', kind: 'agent', color: '#93c47f', parallel: 1, min: 0 },
  { persona: 'you', title: 'you', kind: 'human', color: '#e0bb6e', parallel: null, min: 0 },
];
const ROLES: Readonly<Record<string, string>> = { paul: 'planner', ben: 'builder', ralf: 'reviewer', tessa: 'tester' };
const roleOf = (persona: string): string => ROLES[persona] ?? '';
const titleOf = (persona: string): string => holdTitleOf(LANES, persona, t);

/** Board 10e v2's T-0118: six positions, You at the last. */
const HOLD: McHold = {
  holder: 'you',
  why: 'entry',
  position: 6,
  length: 6,
  chain: ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'],
  mode: null,
  named: null,
  claimed: false,
  sentBack: null,
  questions: 0,
};
const MODES = ['shape', null, null, null, null, null] as const;

const run = (persona: string | null, tokens: string, dauer: string, cost: number | null, model = 'sonnet'): McVerlaufEntry => ({
  phase: 'active',
  persona,
  model,
  tokens,
  cost,
  dauer,
  ausgang: 'handed-over',
});

describe('ticketHoldOf', () => {
  const board = (lanes: unknown): McBoard =>
    ({ columns: [{ phase: { id: 'active', title: 'Active' }, tickets: [{ id: 'T-0118', meta: {}, hold: HOLD }] }], lanes }) as unknown as McBoard;

  it('finds the card’s hold on a persona board', () => {
    expect(ticketHoldOf(board(LANES), 'T-0118')?.hold.position).toBe(6);
  });

  it('is null on a phase board, for another id, or without a board', () => {
    expect(ticketHoldOf(board(undefined), 'T-0118')).toBeNull();
    expect(ticketHoldOf(board(LANES), 'T-0001')).toBeNull();
    expect(ticketHoldOf(null, 'T-0118')).toBeNull();
  });
});

describe('chainModesOf', () => {
  it('reads each position’s mode off the ticket’s chain, the cursor’s off the hold', () => {
    const entries = [{ persona: 'paul', mode: 'shape' as const }, { persona: 'paul', mode: null }, { persona: 'ben', mode: null }];
    expect(chainModesOf({ ...HOLD, position: 3, mode: null }, entries)).toEqual(['shape', null, null, null, null, null]);
  });

  it('trusts no entry whose persona differs from the hold’s chain', () => {
    expect(chainModesOf(HOLD, [{ persona: 'ben', mode: 'shape' }])).toEqual([null, null, null, null, null, null]);
  });
});

describe('holdFlowOf (the flow row)', () => {
  it('names the done positions with a tick, You bold, then the position', () => {
    const flow = holdFlowOf(HOLD, titleOf, t);
    expect(flow.done.map((cell) => cell.label)).toEqual(['✓ Paul', '✓ Paul', '✓ Ben', '✓ Ralf', '✓ Tessa']);
    expect(flow.now).toBe('You');
    expect(flow.note).toBe('(6 of 6)');
    expect(flow.rest).toEqual([]);
  });

  it('lists what is still to come after the cursor', () => {
    const flow = holdFlowOf({ ...HOLD, holder: 'ben', position: 3 }, titleOf, t);
    expect(flow.now).toBe('Ben');
    expect(flow.rest.map((cell) => cell.label)).toEqual(['Ralf', 'Tessa', 'You']);
  });
});

describe('the send-back targets', () => {
  it('offers every earlier position with its word: shape, else the role as its step', () => {
    expect(holdTargetsOf(HOLD, MODES, titleOf, roleOf, t)).toEqual([
      { position: 1, persona: 'paul', label: 'Paul · 1 of 6', word: 'shape' },
      { position: 2, persona: 'paul', label: 'Paul · 2 of 6', word: 'plan' },
      { position: 3, persona: 'ben', label: 'Ben · 3 of 6', word: 'build' },
      { position: 4, persona: 'ralf', label: 'Ralf · 4 of 6', word: 'review' },
      { position: 5, persona: 'tessa', label: 'Tessa · 5 of 6', word: 'test' },
    ]);
  });

  it('presets the last earlier builder, else the position before the cursor, and nothing at position 1', () => {
    expect(defaultTargetOf(HOLD, roleOf)).toBe(3);
    expect(defaultTargetOf(HOLD, () => 'tester')).toBe(5);
    expect(defaultTargetOf({ ...HOLD, position: 1 }, roleOf)).toBeNull();
  });

  it('words a free role label as written', () => {
    expect(roleWordOf('builder', t)).toBe('build');
    expect(roleWordOf('Docs writer', t)).toBe('Docs writer');
    expect(roleWordOf('', t)).toBe('');
  });

  it('calls the human You, whatever the lane’s blank title fell back to', () => {
    expect(titleOf('you')).toBe('You');
    expect(titleOf('nina')).toBe('Nina');
  });
});

describe('the cost by position', () => {
  it('places each run at its persona’s next position (the chain here names Paul twice)', () => {
    const costs = positionCostsOf(
      [run('paul', '16k', '3m', 0.25), run('ben', '88k', '14m', 0.94), run('ralf', '30k', '5m', 0.32), run('tessa', '24k', '6m', 0.27)],
      HOLD,
    );
    expect(costs.map((row) => [row.position, row.persona, row.tokens, row.minutes, row.cost])).toEqual([
      [1, 'paul', 16_000, 3, 0.25],
      [3, 'ben', 88_000, 14, 0.94],
      [4, 'ralf', 30_000, 5, 0.32],
      [5, 'tessa', 24_000, 6, 0.27],
    ]);
  });

  it('sums a send-back’s rerun into the position it went back to', () => {
    const costs = positionCostsOf(
      [run('ben', '50k', '10m', 0.5), run('ralf', '10k', '2m', 0.1), run('ben', '20k', '4m', 0.2), run('ralf', '5k', '1m', 0.05)],
      { chain: HOLD.chain, position: 5 },
    );
    expect(costs.map((row) => [row.position, row.tokens, row.minutes])).toEqual([
      [3, 70_000, 14],
      [4, 15_000, 3],
    ]);
  });

  it('keeps a run of a persona the chain does not name apart, at the end', () => {
    const costs = positionCostsOf([run('nina', '1k', '1m', 0.01), run('ben', '2k', '1m', 0.02)], HOLD);
    expect(costs.map((row) => [row.position, row.persona])).toEqual([
      [3, 'ben'],
      [null, 'nina'],
    ]);
  });

  it('req-305: a shape entry is one position of its persona’s run — Paul’s run sits at position 1 of a flow that names him once', () => {
    expect(positionOfRun('paul', ['paul', 'ben', 'you'], 0, 3)).toBe(1);
  });

  it('takes a later position of the same persona only up to the cursor', () => {
    expect(positionOfRun('ben', ['paul', 'ben', 'ralf', 'ben', 'you'], 3, 3)).toBe(2);
    expect(positionOfRun('ben', ['paul', 'ben', 'ralf', 'ben', 'you'], 3, 5)).toBe(4);
  });

  it('words the rows and the total as the board writes them', () => {
    const view = positionCostViewOf(i18n, positionCostsOf([run('paul', '16k', '3m', 0.25), run('ben', '88k', '14m', 0.94)], HOLD), 6, titleOf);
    expect(view.rows[0]).toEqual({ label: '1 of 6 · Paul', model: 'sonnet', tokens: '16k', time: '3m', cost: '$0.25', sub: 'sonnet · 16k · 3m', bad: false });
    expect(view.total).toEqual({ tokens: '104k', time: '17m', cost: '$1.19', sub: '104k · 17m' });
  });

  it('never counts an unknown figure as zero', () => {
    const view = positionCostViewOf(i18n, positionCostsOf([run('ben', '', '', null, '')], HOLD), 6, titleOf);
    expect(view.rows[0]).toMatchObject({ model: '', tokens: '', time: '', cost: '—', sub: '' });
    expect(view.total).toEqual({ tokens: '', time: '', cost: '—', sub: '' });
  });
});
