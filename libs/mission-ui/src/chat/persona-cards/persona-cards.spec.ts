/**
 * req-273 — the persona board's four Needs-you cards on Mission Control
 * (board MCCardsV2): drawn off the board's holds and the needs, and each
 * button on its seam.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { disconnectedChatState, MC_CHAT_STATE } from '../chat.model';
import { MC_WORK_STATE, type McBoard, type McNeed, type McWorkState } from '../../work/work.model';
import { PersonaCardsView } from './persona-cards';

const CHAIN = ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'];
const lane = (persona: string, title: string, color: string, kind = 'agent') => ({ persona, title, color, kind, parallel: null, min: 0 });
const LANES = [lane('paul', 'Paul', '#aaaaaa'), lane('ben', 'Ben', '#8ecbef'), lane('ralf', 'Ralf', '#f08080'), lane('tessa', 'Tessa', '#cccccc'), lane('you', 'You', '', 'human')];
const hold = (over: Record<string, unknown>) => ({ holder: 'ben', why: 'entry', position: 3, length: 6, chain: CHAIN, mode: null, named: null, claimed: false, sentBack: null, questions: 0, ...over });
const ticket = (id: string, title: string, h: Record<string, unknown>) => ({ id, title, meta: { title }, hold: h });

function board(tickets: readonly unknown[]): McBoard {
  return { columns: [{ phase: { id: 'active', title: 'Active' }, tickets }], lanes: LANES } as unknown as McBoard;
}

function mount(tickets: readonly unknown[], needs: readonly McNeed[], over: Partial<McWorkState> = {}) {
  const state = {
    needs,
    board: board(tickets),
    personas: [],
    readOnly: false,
    moveTicket: vi.fn(),
    handTicket: vi.fn(async () => ({ ok: true as const })),
    answer: vi.fn(async () => ({ ok: true as const })),
    answerDecision: vi.fn(async () => ({ ok: true as const })),
    finishManual: vi.fn(async () => ({ ok: true as const })),
    startTicketRun: vi.fn(async () => ({ ok: true as const })),
    openTicket: vi.fn(),
    openTicketSendBack: vi.fn(),
    ...over,
  } as unknown as McWorkState;
  const chat = { ...disconnectedChatState(), chatPrefill: signal<string | null>(null) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MC_WORK_STATE, useValue: state },
      { provide: MC_CHAT_STATE, useValue: chat },
    ],
  });
  const fixture = TestBed.createComponent(PersonaCardsView);
  fixture.detectChanges();
  return { fixture, state, chat };
}

const el = (fixture: ComponentFixture<unknown>): HTMLElement => fixture.nativeElement as HTMLElement;
const texts = (root: ParentNode, selector: string): string[] => Array.from(root.querySelectorAll(selector)).map((n) => n.textContent!.trim());
const click = async (fixture: ComponentFixture<unknown>, selector: string): Promise<void> => {
  el(fixture).querySelector<HTMLButtonElement>(selector)!.click();
  await fixture.whenStable();
  fixture.detectChanges();
};

const NO_PERSONA = ticket('T-0127', 'Theme picker in the status bar', hold({ why: 'no-persona', holder: 'ghost', position: 4, chain: ['paul', 'paul', 'ben', 'ghost', 'tessa', 'you'] }));
const QUESTION = ticket('T-0121', 'Outline: drag headings to reorder', hold({ why: 'question', named: 'ben' }));
const QUESTION_NEED = {
  kind: 'question',
  ticketId: 'T-0121',
  title: 'x',
  summary: '',
  runId: 'run-1',
  shaped: { question: 'Should dragging a heading also move the text below it?', context: null, where: null, why: null, recommended: null, recommendationWhy: null, options: [{ n: 1, label: 'Move the whole section', consequence: null }, { n: 2, label: 'Only the heading line', consequence: null }] },
} as unknown as McNeed;
const TWICE = ticket('T-0120', 'Tag field: paste a list', hold({ why: 'second-send-back', holder: 'you', position: 4, sentBack: { from: 5, to: 3 } }));
const CONFLICT = ticket('T-0123', 'Order', hold({}));
const CONFLICT_NEED = { kind: 'red-gate', ticketId: 'T-0123', title: 'x', summary: 'sync-main: merging main conflicts in order.ts, order.spec.ts, board.css — the merge was aborted', runId: 'r2' } as McNeed;

describe('Mission Control: the persona board cards (req-273)', () => {
  it('draws the no-persona card: title, ticket, the initials with the peach ··, position, Assign… and Do it myself', () => {
    const root = el(mount([NO_PERSONA], []).fixture);
    const card = root.querySelector('.pcard[data-kind="no-persona"]')!;
    expect(card.querySelector('.pc-title-text')!.textContent).toBe('T-0127 · no persona for position 4');
    expect(texts(card, '.pc-line')).toEqual(['Theme picker in the status bar']);
    expect(texts(card, '.pc-cell').join(' ')).toBe('PA PA BE ·· TE YO');
    expect(card.querySelector('.pc-cell.missing')!.getAttribute('data-state')).toBe('now');
    expect(card.querySelector('.pc-who-text')!.textContent).toBe('Position 4 of 6');
    expect(texts(card, '.pc-btn')).toEqual(['Assign…', 'Do it myself']);
    expect(card.querySelector('.pc-btn.primary')!.textContent!.trim()).toBe('Assign…');
    expect(card.querySelector('.pc-meta')!.textContent).toMatch(/^Mission Control · /);
  });

  it('Assign… opens the picker over the crew\'s agents and hands the ticket to the picked one', async () => {
    const { fixture, state } = mount([NO_PERSONA], []);
    await click(fixture, '[data-action="assign"]');
    expect(texts(el(fixture), '.pc-picker .pc-btn')).toEqual(['Paul', 'Ben', 'Ralf', 'Tessa']);
    await click(fixture, '.pc-picker [data-persona="ralf"]');
    expect(state.handTicket).toHaveBeenCalledWith('T-0127', 'ralf');
    expect(el(fixture).querySelector('.pc-picker')).toBeNull();
  });

  it('Do it myself hands the ticket to you', async () => {
    const { fixture, state } = mount([NO_PERSONA], []);
    await click(fixture, '[data-action="do_myself"]');
    expect(state.handTicket).toHaveBeenCalledWith('T-0127', 'you');
  });

  it('draws a run\'s question and answers through the run', async () => {
    const { fixture, state } = mount([QUESTION], [QUESTION_NEED]);
    const card = el(fixture).querySelector('.pcard[data-kind="question"]')!;
    expect(card.querySelector('.pc-title-text')!.textContent).toBe('T-0121 · Ben asks');
    expect(texts(card, '.pc-line')).toEqual(['Should dragging a heading also move the text below it?', 'Outline: drag headings to reorder']);
    expect(card.querySelector('.pc-line.strong')).not.toBeNull();
    expect(card.querySelector('.pc-who-text')!.textContent).toBe('Ben · 3 of 6');
    expect(texts(card, '.pc-btn')).toEqual(['Move the whole section', 'Only the heading line', 'Write an answer…']);
    await click(fixture, '[data-action="option"]');
    expect(state.answer).toHaveBeenCalledWith('run-1', '1. Move the whole section');
  });

  it('a needs-decision question answers through the ticket\'s answer route with its key', async () => {
    const need = { kind: 'needs-decision', ticketId: 'T-0121', title: 'x', summary: '[palette] Which palette?', runId: null } as McNeed;
    const { fixture, state } = mount([QUESTION], [need]);
    expect(texts(el(fixture), '.pc-btn')).toEqual(['Write an answer…']);
    expect(el(fixture).querySelector('.pc-line.strong')!.textContent).toBe('Which palette?');
    expect(state.answerDecision).not.toHaveBeenCalled();
  });

  it('Write an answer… fills the composer', async () => {
    const { fixture, chat } = mount([QUESTION], [QUESTION_NEED]);
    await click(fixture, '[data-action="write_answer"]');
    expect(chat.chatPrefill()).toBe('About T-0121: ');
  });

  it('draws the sent-back-twice card with its reasons; Send back… opens the panel, Accept accepts', async () => {
    const need = { kind: 'needs-decision', ticketId: 'T-0120', title: 'x', summary: '[second-send-back] a second send-back from position 4: a space splits a tag in two', runId: null } as McNeed;
    const { fixture, state } = mount([TWICE], [need]);
    const card = el(fixture).querySelector('.pcard[data-kind="second-send-back"]')!;
    expect(card.querySelector('.pc-title-text')!.textContent).toBe('T-0120 · sent back twice');
    expect(texts(card, '.pc-row')).toEqual(['1Tessa to Ben', '2Ralf: a space splits a tag in two']);
    await click(fixture, '[data-action="send_back"]');
    expect(state.openTicketSendBack).toHaveBeenCalledWith('T-0120');
    await click(fixture, '[data-action="accept"]');
    expect(state.finishManual).toHaveBeenCalledWith('T-0120');
  });

  it('draws the conflict card: red dot, the body, one C row per file; the three buttons go to their seams', async () => {
    const { fixture, state } = mount([CONFLICT], [CONFLICT_NEED]);
    const card = el(fixture).querySelector('.pcard[data-kind="merge-conflict"]')!;
    expect(card.querySelector('.pc-title-text')!.textContent).toBe('Conflict on T-0123 · merging main');
    expect(card.querySelector('.pc-dot.negative')).not.toBeNull();
    expect(card.querySelector('.pc-line')!.textContent).toBe("3 files conflict: order.ts, order.spec.ts, board.css. Ben's merge stopped; nothing was resolved by a model.");
    expect(card.querySelector('.pc-side')!.textContent).toBe('merging main');
    expect(texts(card, '.pc-row')).toEqual(['Corder.ts', 'Corder.spec.ts', 'Cboard.css']);
    expect(texts(card, '.pc-btn')).toEqual(['Resolve in Drey', 'Let Ben resolve', 'Do it myself']);
    await click(fixture, '[data-action="resolve"]');
    expect(state.openTicket).toHaveBeenCalledWith('T-0123');
    await click(fixture, '[data-action="let_resolve"]');
    expect(state.startTicketRun).toHaveBeenCalledWith('T-0123');
  });

  it('a refused action shows the desk\'s words on the card', async () => {
    const { fixture } = mount([NO_PERSONA], [], { handTicket: vi.fn(async () => ({ ok: false as const, error: 'running at Ben' })) });
    await click(fixture, '[data-action="do_myself"]');
    expect(el(fixture).querySelector('.pc-err')!.textContent).toBe('running at Ben');
  });

  it('a read-only device shows the cards without actions', () => {
    const { fixture } = mount([NO_PERSONA], [], { readOnly: true });
    expect(el(fixture).querySelector('.pcard')).not.toBeNull();
    expect(el(fixture).querySelector('.pc-btn')).toBeNull();
  });

  it('draws nothing on a board without lanes', () => {
    const { fixture } = mount([NO_PERSONA], [], { board: { columns: [] } as unknown as McBoard });
    expect(el(fixture).querySelector('.pcard')).toBeNull();
  });
});
