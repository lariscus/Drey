import { describe, expect, it } from 'vitest';
import { McI18n } from '../i18n/i18n.service';
import { personaDeskGroupsOf } from './holder-desk';
import { holderGroupsOf, laneLoadLineOf } from './holder-rows';
import { lanesOf, type McHoldRun, type McLane } from './hold';
import { groupsOf, type McBoard, type McNeed } from './work.model';

const i18n = new McI18n();
const t = i18n.t.bind(i18n);
const NOW = Date.parse('2026-11-13T14:10:00Z');
const STANDARD = ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'];

const lane = (persona: string, title: string, kind: McLane['kind'], parallel: number | null): McLane => ({ persona, title, kind, color: '#8ecbef', parallel, min: 0 });
const LANES = [lane('paul', 'Paul', 'agent', 1), lane('ben', 'Ben', 'agent', 2), lane('ralf', 'Ralf', 'agent', 1), lane('tessa', 'Tessa', 'agent', 1), lane('you', 'You', 'human', null)];

interface HoldSeed {
  readonly holder: string;
  readonly position: number;
  readonly why?: string;
  readonly named?: string;
  readonly sentBack?: { from: number; to: number };
  readonly mode?: 'shape';
  readonly chain?: readonly string[];
}

const card = (id: string, phase: string, title: string, hold?: HoldSeed, cost?: number) => ({
  id,
  phase,
  meta: { id, title },
  blocked: [],
  ...(cost === undefined ? {} : { usage: { tokensIn: 1, tokensOut: 1, cost, runs: 1 } }),
  ...(hold === undefined
    ? {}
    : {
        hold: {
          holder: hold.holder,
          why: hold.why ?? 'entry',
          position: hold.position,
          length: (hold.chain ?? STANDARD).length,
          chain: hold.chain ?? STANDARD,
          mode: hold.mode ?? null,
          named: hold.named ?? null,
          claimed: false,
          sentBack: hold.sentBack ?? null,
          questions: hold.why === 'question' ? 1 : 0,
        },
      }),
});

const BOARD = {
  lanes: LANES,
  columns: [
    { phase: { id: 'inbox', title: 'Inbox' }, tickets: [card('T-0140', 'inbox', 'Sync status')] },
    { phase: { id: 'prioritized', title: 'Prioritized' }, tickets: [card('T-0141', 'prioritized', 'Pin tabs')] },
    {
      phase: { id: 'active', title: 'Active' },
      tickets: [
        card('T-0134', 'active', 'Voice capture for tickets', { holder: 'paul', position: 1, mode: 'shape' }, 0.18),
        card('T-0131', 'active', 'Weekly security audit run', { holder: 'paul', position: 1, chain: ['paul', 'you'] }, 0.46),
        card('T-0130', 'active', 'Export the vault as a zip', { holder: 'ben', position: 3, sentBack: { from: 5, to: 3 } }, 0.74),
        card('T-0123', 'active', 'Palette: recent commands', { holder: 'ben', position: 3 }, 0.88),
        card('T-0122', 'active', 'Win+H dictation hand-off', { holder: 'ben', position: 3 }),
        card('T-0121', 'active', 'Outline: drag headings to reorder', { holder: 'you', position: 3, why: 'question', named: 'ben' }, 1.2),
        card('T-0127', 'active', 'Theme picker in the status bar', { holder: 'you', position: 4, why: 'no-persona' }),
        card('T-0120', 'active', 'Tag field: paste a list', { holder: 'you', position: 4, why: 'second-send-back', sentBack: { from: 5, to: 4 } }, 1.96),
        card('T-0118', 'active', 'Palette opens twice on slow CI', { holder: 'you', position: 6 }, 1.84),
      ],
    },
    { phase: { id: 'done', title: 'Done' }, tickets: [] },
  ],
  recentDone: [{ id: 'T-0100', title: 'Shipped', at: '' }],
} as unknown as McBoard;

const NEEDS: McNeed[] = [
  { kind: 'manual', ticketId: 'T-0120', title: 'Tag field: paste a list', summary: '' },
  { kind: 'needs-decision', ticketId: 'T-0121', title: 'Outline: drag headings to reorder', summary: 'Should dragging move the text?' },
];
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const RUNS: McHoldRun[] = [
  { ticketId: 'T-0131', persona: 'paul', state: 'running', startedAt: at(6) },
  { ticketId: 'T-0130', persona: 'ben', state: 'running', startedAt: at(3) },
  { ticketId: 'T-0123', persona: 'ben', state: 'running', startedAt: at(11), activity: 'merging main' },
];
const WAITS = { personaWaits: { 'T-0122': 'ben' }, queued: {} };

const holders = () =>
  holderGroupsOf({ lanes: lanesOf(BOARD)!, groups: groupsOf(NEEDS, BOARD, []), done: BOARD.recentDone ?? [], runs: RUNS, waits: WAITS, paused: [], now: NOW }, t);

describe('holderGroupsOf (boards 10c v2, 10e v2)', () => {
  it('lists Needs you, then each holder in the crew order, then the folded lifecycle groups', () => {
    expect(holders().map((group) => [group.title, group.rows.length, group.startsOpen])).toEqual([
      ['Needs you', 4, true],
      ['Paul', 2, true],
      ['Ben', 3, true],
      ['Prioritized', 1, false],
      ['Inbox', 1, false],
      ['Done this week', 1, false],
    ]);
  });

  it('orders Needs you by why it stands at You, the meta `id · n/m · word`', () => {
    expect(holders()[0]!.rows.map((row) => row.meta)).toEqual([
      'T-0121 · 3/6 · Ben asks',
      'T-0127 · 4/6 · no persona',
      'T-0120 · 4/6 · sent back twice',
      'T-0118 · 6/6 · Accept',
    ]);
  });

  it('words a holder row by its send-back, then what its run does', () => {
    const [, paul, ben] = holders();
    expect(paul!.rows.map((row) => row.meta)).toEqual(['T-0134 · 1/6 · shaping with you', 'T-0131 · 1/2 · running']);
    expect(ben!.rows.map((row) => row.meta)).toEqual(['T-0130 · 3/6 · sent back', 'T-0123 · 3/6 · merging main', 'T-0122 · 3/6 · waits for Ben']);
    expect(ben!.rows[0]!.cost).toBe('$0.74');
  });

  it('carries the holder circle and the load on an agent group', () => {
    const [, paul, ben] = holders();
    expect(ben!.persona).toEqual({ id: 'ben', title: 'Ben', color: '#8ecbef' });
    expect(ben!.load).toBe('Ben · 2/2 · 1 waiting');
    expect(paul!.load).toBe('Paul · 1/1');
  });

  it('words the load line like the desktop board', () => {
    expect(laneLoadLineOf(lane('ben', 'Ben', 'agent', null), 3, 0, t)).toBe('Ben · 3 running');
    expect(laneLoadLineOf(lane('you', 'You', 'human', null), 0, 2, t)).toBeNull();
  });
});

describe('personaDeskGroupsOf (the desk wide list)', () => {
  it('keeps the need cards, puts You approvals next, then the holders with their load as the head', () => {
    const all = groupsOf(NEEDS, BOARD, []);
    const desk = personaDeskGroupsOf(all, holders(), 'You');
    expect(desk.map((group) => [group.kind, group.title, group.kind === 'needs' ? group.needs.length : group.tickets.length])).toEqual([
      ['needs', 'Needs you', 2],
      ['phase', 'You', 2],
      ['phase', 'Paul · 1/1', 2],
      ['phase', 'Ben · 2/2 · 1 waiting', 3],
      ['phase', 'Prioritized', 1],
      ['phase', 'Inbox', 1],
    ]);
  });
});
