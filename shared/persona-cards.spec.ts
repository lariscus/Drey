import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, createI18n, loadCatalog } from './i18n';
import { personaCardsOf, type CardHold, type CardLane, type CardNeed, type CardTicket, type PersonaCardFormat } from './persona-cards';

const i18n = createI18n({ locale: DEFAULT_LOCALE, catalog: loadCatalog(DEFAULT_LOCALE) });
const f: PersonaCardFormat = { t: (key, params) => i18n.t(key, params), time: () => '14:05', money: (n) => `$${n.toFixed(2)}` };
const NOW = new Date('2026-11-13T14:05:00');

const lanes: readonly CardLane[] = [
  { persona: 'paul', title: 'Paul', color: '#aaaaaa' },
  { persona: 'ben', title: 'Ben', color: '#8ecbef' },
  { persona: 'ralf', title: 'Ralf', color: '#f08080' },
  { persona: 'tessa', title: 'Tessa', color: '#cccccc' },
  { persona: 'you', title: 'You', color: '' },
];

const hold = (over: Partial<CardHold>): CardHold => ({
  holder: 'ben',
  why: 'entry',
  position: 3,
  length: 6,
  chain: ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'],
  named: null,
  sentBack: null,
  ...over,
});
const ticket = (id: string, title: string, h: CardHold, cost: number | null = null): CardTicket => ({ id, title, cost, hold: h });
const need = (over: Partial<CardNeed>): CardNeed => ({ kind: 'question', ticketId: 'T-1', text: '', runId: null, since: null, ...over });

describe('personaCardsOf', () => {
  it('draws nothing on a board without lanes', () => {
    expect(personaCardsOf({ lanes: [], tickets: [ticket('T-1', 'x', hold({ why: 'no-persona' }))], needs: [] }, f, NOW)).toEqual([]);
  });

  it('words the no-persona card with the missing cell and its two buttons', () => {
    const [card] = personaCardsOf(
      { lanes, needs: [], tickets: [ticket('T-0127', 'Theme picker', hold({ why: 'no-persona', holder: 'nobody', position: 4, chain: ['paul', 'paul', 'ben', 'ghost', 'tessa', 'you'] }))] },
      f,
      NOW,
    );
    expect(card?.title).toBe('T-0127 · no persona for position 4');
    expect(card?.who).toBe('Position 4 of 6');
    expect(card?.cells.map((c) => c.initials).join(' ')).toBe('PA PA BE ·· TE YO');
    expect(card?.cells.map((c) => c.state)).toEqual(['done', 'done', 'done', 'now', 'next', 'next']);
    expect(card?.cells[3]?.missing).toBe(true);
    expect(card?.actions.map((a) => [a.label, a.primary])).toEqual([
      ['Assign…', true],
      ['Do it myself', false],
    ]);
    expect(card?.meta).toBe('Mission Control · 14:05');
  });

  it('turns a shaped question into option buttons, the first primary, and a write-an-answer', () => {
    const [card] = personaCardsOf(
      {
        lanes,
        tickets: [ticket('T-1', 'Outline: drag', hold({ why: 'question', named: 'ben' }), 1.2)],
        needs: [
          need({
            runId: 'r1',
            since: '2026-11-13T14:04:00',
            shaped: { question: 'Move the text too?', options: [{ n: 1, label: 'Move the whole section' }, { n: 2, label: 'Only the heading line' }] },
          }),
        ],
      },
      f,
      NOW,
    );
    expect(card?.title).toBe('T-1 · Ben asks');
    expect(card?.lines.map((l) => l.text)).toEqual(['Move the text too?', 'Outline: drag']);
    expect(card?.who).toBe('Ben · 3 of 6');
    expect(card?.side).toBe('$1.20');
    expect(card?.actions.map((a) => [a.label, a.primary, a.answer])).toEqual([
      ['Move the whole section', true, '1. Move the whole section'],
      ['Only the heading line', false, '2. Only the heading line'],
      ['Write an answer…', false, undefined],
    ]);
    expect(card?.runId).toBe('r1');
  });

  it('makes write-an-answer primary when a needs-decision offers no option, and keeps its key', () => {
    const [card] = personaCardsOf(
      {
        lanes,
        tickets: [ticket('T-1', 'x', hold({ why: 'question', named: 'ben' }))],
        needs: [need({ kind: 'needs-decision', text: '[palette] Which palette?' })],
      },
      f,
      NOW,
    );
    expect(card?.lines[0]?.text).toBe('Which palette?');
    expect(card?.decisionKey).toBe('palette');
    expect(card?.actions).toEqual([{ id: 'write_answer', label: 'Write an answer…', primary: true }]);
  });

  it('lists both send-back reasons on the second-send-back card', () => {
    const [card] = personaCardsOf(
      {
        lanes,
        tickets: [ticket('T-1', 'Tag field', hold({ why: 'second-send-back', holder: 'you', position: 4, sentBack: { from: 5, to: 3 } }), 1.96)],
        needs: [need({ kind: 'needs-decision', text: '[second-send-back] a second send-back from position 4: a space splits a tag in two' })],
        logs: { 'T-1': 'sent back 5>3 — from 5 (tessa) to 3 (ben): pasted tags lose their order; positions 3–6 run again' },
      },
      f,
      NOW,
    );
    expect(card?.title).toBe('T-1 · sent back twice');
    expect(card?.rows.map((r) => [r.mark, r.text])).toEqual([
      ['1', 'Tessa to Ben: pasted tags lose their order'],
      ['2', 'Ralf: a space splits a tag in two'],
    ]);
    expect(card?.actions.map((a) => a.label)).toEqual(['Send back…', 'Accept']);
  });

  it('keeps the names of the first send-back when no Log is at hand', () => {
    const [card] = personaCardsOf({ lanes, needs: [], tickets: [ticket('T-1', 't', hold({ why: 'second-send-back', sentBack: { from: 5, to: 3 } }))] }, f, NOW);
    expect(card?.rows.map((r) => r.text)).toEqual(['Tessa to Ben']);
  });

  it('reads a sync-main conflict into the conflict card', () => {
    const [card] = personaCardsOf(
      {
        lanes,
        tickets: [ticket('T-0123', 'Order', hold({}))],
        needs: [need({ kind: 'red-gate', ticketId: 'T-0123', text: 'sync-main: merging main conflicts in order.ts, order.spec.ts, board.css — the merge was aborted' })],
      },
      f,
      NOW,
    );
    expect(card?.title).toBe('Conflict on T-0123 · merging main');
    expect(card?.tone).toBe('negative');
    expect(card?.lines[0]?.text).toBe("3 files conflict: order.ts, order.spec.ts, board.css. Ben's merge stopped; nothing was resolved by a model.");
    expect(card?.side).toBe('merging main');
    expect(card?.rows.map((r) => r.text)).toEqual(['order.ts', 'order.spec.ts', 'board.css']);
    expect(card?.actions.map((a) => a.label)).toEqual(['Resolve in Drey', 'Let Ben resolve', 'Do it myself']);
  });

  it('ignores a red gate that is no merge conflict', () => {
    expect(personaCardsOf({ lanes, tickets: [ticket('T-1', 't', hold({}))], needs: [need({ kind: 'red-gate', text: 'the gate is red' })] }, f, NOW)).toEqual([]);
  });
});
