import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { McVerlaufEntry } from '../api/dto';
import type { McHold } from '../work/hold';
import { MC_WORK_STATE, type McAnswerReply, type McBoard, type McWorkState } from '../work/work.model';
import { TicketHoldFace, type HoldChecks } from './hold-decision';
import type { TicketDoc } from './ticket.model';

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

const LANES = ['paul', 'ben', 'ralf', 'tessa', 'you'].map((persona) => ({
  persona,
  title: persona === 'you' ? 'You' : persona.charAt(0).toUpperCase() + persona.slice(1),
  kind: persona === 'you' ? 'human' : 'agent',
  color: persona === 'you' ? '#e0bb6e' : '',
}));

const PERSONAS = [
  { id: 'paul', title: 'Paul', color: '#f3c1d3', role: 'planner' },
  { id: 'ben', title: 'Ben', color: '#9fd0f0', role: 'builder' },
  { id: 'ralf', title: 'Ralf', color: '#c9b6f2', role: 'reviewer' },
  { id: 'tessa', title: 'Tessa', color: '#93c47f', role: 'tester' },
  { id: 'you', title: 'You', color: '#e0bb6e', kind: 'human' },
];

const VERLAUF: readonly McVerlaufEntry[] = [
  { phase: 'active', persona: 'ben', model: 'sonnet', tokens: '88k', cost: 0.94, dauer: '14m', ausgang: 'handed-over' },
];

const DOC = {
  id: 'T-0118',
  title: 'Palette opens twice on slow CI',
  text: '',
  revision: 'r1',
  phase: 'active',
  phases: [],
  chain: [
    { persona: 'paul', mode: 'shape', notify: false },
    ...['paul', 'ben', 'ralf', 'tessa', 'you'].map((persona) => ({ persona, mode: null, notify: false })),
  ],
  priority: null,
  priorities: [],
  blocked: [],
  blockedBy: [],
  verlauf: VERLAUF,
} as unknown as TicketDoc;

interface Calls {
  finish: string[];
  back: [string, string, number | undefined][];
}

function boardOf(hold: McHold, lanes: unknown): McBoard {
  return { columns: [{ phase: { id: 'active', title: 'Active' }, tickets: [{ id: 'T-0118', meta: {}, hold }] }], lanes } as unknown as McBoard;
}

function setup(opts: { hold?: McHold; lanes?: unknown; readOnly?: boolean; checks?: HoldChecks | null; reply?: McAnswerReply } = {}): { face: TicketHoldFace; calls: Calls } {
  const calls: Calls = { finish: [], back: [] };
  const reply = opts.reply ?? { ok: true };
  const work = {
    needs: [],
    board: boardOf(opts.hold ?? HOLD, 'lanes' in opts ? opts.lanes : LANES),
    personas: PERSONAS,
    readOnly: false,
    moveTicket: () => Promise.resolve({ ok: true }),
    finishManual: (id: string) => {
      calls.finish.push(id);
      return Promise.resolve(reply);
    },
    sendBackManual: (id: string, note: string, position?: number) => {
      calls.back.push([id, note, position]);
      return Promise.resolve(reply);
    },
  } as unknown as McWorkState;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: MC_WORK_STATE, useValue: work }] });
  const face = TestBed.runInInjectionContext(
    () =>
      new TicketHoldFace({
        doc: signal(DOC),
        readOnly: signal(opts.readOnly ?? false),
        checks: signal(opts.checks === undefined ? { passed: 4, total: 4 } : opts.checks),
      }),
  );
  return { face, calls };
}

describe('TicketHoldFace — the rows (boards 10e v2, 10o v2)', () => {
  it('words the head chip, the holder and the flow', () => {
    const { face } = setup();
    expect(face.active()).toBe(true);
    expect(face.padChip()).toBe('You · 6 of 6');
    expect(face.phoneChip()).toBe('6 of 6');
    expect(face.holder()).toEqual({ persona: 'you', name: 'You', color: '#e0bb6e' });
    expect(face.phoneDone()).toBe('✓ Paul · ✓ Paul · ✓ Ben · ✓ Ralf · ✓ Tessa');
    expect(face.phoneRest()).toBe('');
    expect(face.costs()?.rows.map((row) => row.label)).toEqual(['3 of 6 · Ben']);
  });

  it('falls back to the persona list’s colour when the lane has none', () => {
    const { face } = setup({ hold: { ...HOLD, holder: 'ben', position: 3 } });
    expect(face.holder()?.color).toBe('#9fd0f0');
    expect(face.phoneRest()).toBe('· Ralf · Tessa · You');
  });

  it('stays inactive on a phase board ticket', () => {
    const { face } = setup({ lanes: undefined });
    expect(face.active()).toBe(false);
    expect(face.flow()).toBeNull();
    expect(face.padCard()).toBeNull();
  });
});

describe('TicketHoldFace — the decision at You', () => {
  it('offers the earlier positions, preset to the last builder', () => {
    const { face } = setup();
    expect(face.targets()?.map((row) => row.label)).toEqual(['Paul · 1 of 6', 'Paul · 2 of 6', 'Ben · 3 of 6', 'Ralf · 4 of 6', 'Tessa · 5 of 6']);
    expect(face.target()).toBe(3);
    expect(face.sendBackLabel()).toBe('Send back to Ben');
    face.pickTarget('2');
    expect(face.target()).toBe(2);
    expect(face.sendBackLabel()).toBe('Send back to Paul');
  });

  it('has no decision where a question, another holder or a read-only device stands', () => {
    expect(setup({ hold: { ...HOLD, why: 'question' } }).face.targets()).toBeNull();
    expect(setup({ hold: { ...HOLD, holder: 'tessa', position: 5 } }).face.targets()).toBeNull();
    expect(setup({ readOnly: true }).face.targets()).toBeNull();
    expect(setup({ hold: { ...HOLD, why: 'second-send-back' } }).face.targets()).not.toBeNull();
  });

  it('words the lead, the link and the phone bar off the checks', () => {
    const { face } = setup();
    expect(face.lead()).toBe('Tessa passed all 4 checks on T-0118. It waits for you.');
    expect(face.link()).toBe('Decision waiting · Tessa passed 4 of 4 checks');
    expect(face.head()).toBe('T-0118 is ready to try.');
    expect(face.body()).toBe('All 4 checks are green.');
    const red = setup({ checks: { passed: 3, total: 4 } }).face;
    expect(red.lead()).toBe('Tessa passed 3 of 4 checks on T-0118. It waits for you.');
    const none = setup({ checks: null }).face;
    expect(none.lead()).toBe('T-0118 waits for you.');
    expect(none.body()).toBe('');
  });

  it('accepts through finishManual', async () => {
    const { face, calls } = setup();
    await face.accept();
    expect(calls.finish).toEqual(['T-0118']);
    expect(face.done()).toBe('Accepted.');
  });

  it('sends back only with a note, to the chosen position', async () => {
    const { face, calls } = setup();
    await face.sendBack();
    expect(calls.back).toEqual([]);
    expect(face.error()).toBe('What is wrong? A send-back needs a note.');
    face.setNote('Callout colors are still wrong in dark mode.');
    expect(face.error()).toBeNull();
    await face.sendBack();
    expect(calls.back).toEqual([['T-0118', 'Callout colors are still wrong in dark mode.', 3]]);
    expect(face.done()).toBe('Sent back.');
  });

  it('shows the desk’s refusal', async () => {
    const { face } = setup({ reply: { ok: false, error: 'A run holds the claim.' } });
    await face.accept();
    expect(face.error()).toBe('A run holds the claim.');
    expect(face.done()).toBeNull();
  });

  it('publishes the iPad card with the decision’s words', () => {
    const card = setup().face.padCard();
    expect(card?.question).toBe('T-0118 is ready to try');
    expect(card?.hold?.who).toBe('Mission Control');
    expect(card?.hold?.acceptLabel).toBe('Accept');
    expect(card?.hold?.targetsLabel).toBe('Send back to');
    expect(card?.hold?.targets.map((row) => row.word)).toEqual(['shape', 'plan', 'build', 'review', 'test']);
    expect(card?.selected()).toBe(3);
  });

  it('starts a fresh ticket clean', () => {
    const { face } = setup();
    face.pickTarget(1);
    face.setNote('x');
    face.toggleNote();
    face.reset();
    expect(face.target()).toBe(3);
    expect(face.note()).toBe('');
    expect(face.noteOpen()).toBe(false);
  });
});
