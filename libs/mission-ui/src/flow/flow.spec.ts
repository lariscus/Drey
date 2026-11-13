import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { parseFlow, type McFlow, type McFlowStep } from '../api/dto';
import { FlowEditor } from './flow';
import {
  MC_FLOW_STATE,
  addablePersonasOf,
  changedIndicesOf,
  changesLabelOf,
  eyebrowOf,
  isDirty,
  marksOf,
  moveRoomOf,
  runsAfterOf,
  whoOf,
  type McFlowOp,
  type McFlowReply,
  type McFlowState,
} from './flow.model';

const step = (index: number, persona: string, extra: Partial<McFlowStep> = {}): McFlowStep => ({
  index,
  position: index + 1,
  persona,
  title: persona.charAt(0).toUpperCase() + persona.slice(1),
  mode: null,
  state: 'future',
  notify: false,
  model: null,
  owner: false,
  missing: false,
  locked: false,
  ...extra,
});

const BASE_STEPS: McFlowStep[] = [
  step(0, 'ben', { state: 'current', model: 'sonnet', locked: true }),
  step(1, 'ralf', { model: 'opus' }),
  step(2, 'tessa', { model: 'sonnet' }),
  step(3, 'you', { owner: true, title: 'You' }),
];

const flow = (extra: Partial<McFlow> = {}): McFlow => ({
  ticket: 'T-0130',
  title: 'Voice capture for tickets',
  scope: { kind: 'ticket' },
  chain: ['ben', 'ralf', 'tessa', 'you'],
  saved: ['ben', 'ralf', 'tessa', 'you'],
  steps: BASE_STEPS,
  personas: [
    { id: 'ben', kind: 'agent', title: 'Ben', color: '#6aa', model: 'sonnet' },
    { id: 'ralf', kind: 'agent', title: 'Ralf', color: '#a6a', model: 'opus' },
    { id: 'tessa', kind: 'agent', title: 'Tessa', color: '#aa6', model: 'sonnet' },
    { id: 'you', kind: 'human', title: 'You', color: '#38bdf8', model: '' },
  ],
  readOnly: null,
  reason: null,
  ...extra,
});

describe('parseFlow', () => {
  it('reads the desk answer tolerantly', () => {
    const read = parseFlow({
      ok: true,
      ticket: 'T-0130',
      title: 'x',
      scope: { kind: 'part', index: 1, title: 'Dictation' },
      chain: ['ben', 'tessa(notify)', 7],
      saved: [],
      steps: [{ index: 2, position: 3, persona: 'tessa', title: 'Tessa', mode: 'shape', state: 'future', notify: true, missing: true }, { persona: 'broken' }],
      personas: [{ id: 'ben', title: 'Ben', color: '#fff', model: 'sonnet' }],
      readOnly: null,
      reason: 'because',
    })!;
    expect(read.scope).toEqual({ kind: 'part', index: 1, title: 'Dictation' });
    expect(read.chain).toEqual(['ben', 'tessa(notify)']);
    expect(read.steps).toHaveLength(1);
    expect(read.steps[0]).toMatchObject({ index: 2, position: 3, persona: 'tessa', mode: 'shape', notify: true, missing: true, owner: false, locked: false });
    expect(read.reason).toBe('because');
    expect(parseFlow({ ok: false, error: 'no' })).toBeNull();
    expect(parseFlow(null)).toBeNull();
  });
});

describe('the helpers', () => {
  it('words the chip and the eyebrow', () => {
    expect(changesLabelOf(['ben'])).toBe('1 step');
    expect(changesLabelOf(['ben', 'you'])).toBe('2 steps');
    expect(eyebrowOf(flow())).toBe('Flow');
    expect(eyebrowOf(flow({ scope: { kind: 'part', index: 1, title: 'x' } }))).toBe('Flow · Part 2');
  });

  it('says whether the draft differs from what is saved', () => {
    expect(isDirty(flow(), flow())).toBe(false);
    expect(isDirty(flow({ chain: ['ben', 'you'] }), flow())).toBe(true);
    expect(isDirty(null, flow())).toBe(false);
  });

  it('marks only the changed positions as dashed: an added one, a swapped persona, a new mark', () => {
    const saved = flow();
    const added = flow({ steps: [...BASE_STEPS, step(4, 'ralf')] });
    expect([...changedIndicesOf(added, saved)]).toEqual([4]);
    const swapped = flow({ steps: BASE_STEPS.map((s) => (s.index === 2 ? { ...s, persona: 'ralf' } : s)) });
    expect([...changedIndicesOf(swapped, saved)]).toEqual([2]);
    const notified = flow({ steps: BASE_STEPS.map((s) => (s.index === 1 ? { ...s, notify: true } : s)) });
    expect([...changedIndicesOf(notified, saved)]).toEqual([1]);
    expect(changedIndicesOf(saved, null).size).toBe(0);
  });

  it('names who works a position and lists its marks', () => {
    const f = flow();
    expect(whoOf(BASE_STEPS[1]!, f)).toBe('Ralf');
    expect(whoOf(BASE_STEPS[3]!, f)).toBe('you');
    expect(whoOf(step(9, 'ghost', { missing: true, title: 'ghost' }), f)).toBe('ghost');
    expect(marksOf(step(1, 'a', { mode: 'shape', notify: true }))).toEqual(['shape', 'tell me']);
    expect(marksOf(step(1, 'a'))).toEqual([]);
  });

  it('finds what a position runs after and where it may move', () => {
    const f = flow();
    expect(runsAfterOf(f, BASE_STEPS[2]!)?.persona).toBe('ralf');
    expect(runsAfterOf(f, BASE_STEPS[0]!)).toBeNull();
    expect(moveRoomOf(f, BASE_STEPS[0]!)).toEqual({ earlier: false, later: false });
    expect(moveRoomOf(f, BASE_STEPS[1]!)).toEqual({ earlier: false, later: true }); // behind the running position
    expect(moveRoomOf(f, BASE_STEPS[2]!)).toEqual({ earlier: true, later: true });
    expect(moveRoomOf(f, BASE_STEPS[3]!)).toEqual({ earlier: true, later: false });
  });

  it('offers the whole crew to add', () => {
    expect(addablePersonasOf(flow()).map((p) => p.id)).toEqual(['ben', 'ralf', 'tessa', 'you']);
  });
});

// --- the screen -------------------------------------------------------------------

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const text = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ');

function mount(
  initial: McFlow | null,
  options: { saved?: McFlow; readOnly?: boolean; reason?: string; edit?: (op: McFlowOp) => Promise<McFlowReply>; draft?: McFlowState['draft']; save?: McFlowState['save'] } = {},
): { el: HTMLElement; ops: McFlowOp[]; state: McFlowState; click: (selector: string, index?: number) => void; settle: () => Promise<void> } {
  const ops: McFlowOp[] = [];
  const state: McFlowState = {
    flow: () => initial,
    saved: () => options.saved ?? initial,
    error: () => null,
    readOnly: () => options.readOnly ?? false,
    edit:
      options.edit ??
      (async (op) => {
        ops.push(op);
        return { ok: true };
      }),
    draft: options.draft ?? (async () => ({ ok: true })),
    paulReason: () => options.reason ?? null,
    undoDraft: vi.fn(),
    save: options.save ?? (async () => ({ ok: true })),
    close: vi.fn(),
  };
  TestBed.configureTestingModule({ providers: [{ provide: MC_FLOW_STATE, useValue: state }] });
  const fixture = TestBed.createComponent(FlowEditor);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const click = (selector: string, index = 0): void => {
    (el.querySelectorAll(selector)[index] as HTMLElement).click();
    fixture.detectChanges();
  };
  const settle = async (): Promise<void> => {
    await flush();
    fixture.detectChanges();
  };
  return { el, ops, state, click, settle };
}

describe('FlowEditor', () => {
  it('shows the send-back rule once, under the list (req-273)', () => {
    const { el } = mount(flow());
    const rules = el.querySelectorAll('.flow-sendback-rule');
    expect(rules).toHaveLength(1);
    expect(text(rules[0] as HTMLElement)).toContain('earlier position');
  });

  it('shows no model for the owner and lists the whole crew for any position', () => {
    const { el, click } = mount(flow());
    click('.fe-gate', 3);
    const panel = text(el.querySelector('.fe-inspector') as HTMLElement);
    expect(panel).toContain('You');
    expect(panel).not.toContain('Model');
    click('.fe-gate', 2);
    const agent = text(el.querySelector('.fe-inspector') as HTMLElement);
    expect(agent).toContain('Ralf');
    expect(agent).toContain('You');
    expect(agent).not.toContain('Pipeline default');
  });

  it('shows the positions with who works them, the running one marked, and the step chip', () => {
    const { el } = mount(flow());
    const body = text(el);
    expect(body).toContain('Voice capture for tickets');
    expect(el.querySelectorAll('.fe-gate')).toHaveLength(4);
    expect(body).toContain('Ben · sonnet');
    expect(body).toContain('current');
    expect(body).toContain('you');
    expect(el.querySelector('.fe-chip')?.textContent).toContain('4 steps');
    expect(el.querySelectorAll('.fe-plus')).toHaveLength(4);
    expect(text(el).toLowerCase()).not.toMatch(/overlap|touches|routing/);
  });

  it('titles a part flow and draws a changed position dashed', () => {
    const draft = flow({
      scope: { kind: 'part', index: 1, title: 'Dictation hand-off' },
      chain: ['ben', 'ralf', 'tessa(notify)', 'you'],
      steps: BASE_STEPS.map((s) => (s.index === 2 ? { ...s, notify: true } : s)),
    });
    const { el } = mount(draft, { saved: flow({ scope: draft.scope }) });
    expect(text(el)).toContain('Flow · Part 2');
    expect(text(el)).toContain('Dictation hand-off');
    const dashed = el.querySelectorAll('.fe-gate.dashed');
    expect(dashed).toHaveLength(1);
    expect(dashed[0]!.textContent).toContain('Tessa');
    expect(dashed[0]!.textContent).toContain('tell me');
  });

  it('opens the inspector for a position: who, model, tell me, runs after, move, add, remove', () => {
    const { el, click } = mount(flow());
    click('.fe-gate', 2);
    const panel = text(el.querySelector('.fe-inspector') as HTMLElement);
    expect(panel).toContain('Tessa');
    expect(panel).toContain('Ralf');
    expect(panel).toContain('sonnet');
    expect(panel).toContain('Tell me when it is done');
    expect(panel).toContain('Runs after');
    expect(panel).toContain('↑ Earlier');
    expect(panel).toContain('↓ Later');
    expect(panel).toContain('Add a persona after');
    expect(panel).toContain('Remove position');
  });

  it('turns taps into edits on the position index', async () => {
    const { el, ops, click, settle } = mount(flow());
    click('.fe-gate', 2); // tessa, index 2
    click('.fe-inspector .fe-chips .chip', 1); // ben, ralf, tessa, you -> ralf
    await settle();
    click('.fe-switch');
    await settle();
    click('.fe-actions .fe-btn', 0); // earlier
    await settle();
    click('.fe-actions .fe-btn', 1); // later
    await settle();
    expect(ops).toEqual([
      { op: 'persona', step: 2, persona: 'ralf' },
      { op: 'notify', step: 2, on: true },
      { op: 'move', step: 2, dir: -1 },
      { op: 'move', step: 1, dir: 1 }, // the selection followed the position up
    ]);
    expect(el.querySelector('.fe-error')).toBeNull();
  });

  it('adds a persona from a connector picker', async () => {
    const { el, ops, click, settle } = mount(flow());
    click('.fe-plus', 1); // after ralf (index 1)
    const options = [...el.querySelectorAll('.fe-add .chip')].map((c) => c.textContent?.trim());
    expect(options).toEqual(['Ben', 'Ralf', 'Tessa', 'You']);
    click('.fe-add .chip', 2);
    await settle();
    expect(ops).toEqual([{ op: 'insert', persona: 'tessa', after: 1 }]);
  });

  it('keeps the running position fixed', () => {
    const { el, click } = mount(flow());
    click('.fe-gate', 0);
    expect(text(el.querySelector('.fe-inspector') as HTMLElement)).toContain('This is the current position');
    expect((el.querySelector('.fe-switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a refusal inline and keeps working', async () => {
    const { el, click, settle } = mount(flow(), { edit: async () => ({ ok: false, error: 'Review is done — only gates that have not begun can change' }) });
    click('.fe-gate', 2);
    click('.fe-switch');
    await settle();
    expect(el.querySelector('.fe-error')?.textContent).toContain('only gates that have not begun can change');
  });

  it('saves only a changed draft, and asks Paul with or without words', async () => {
    const save = vi.fn(async (): Promise<McFlowReply> => ({ ok: true }));
    const draft = vi.fn(async (): Promise<McFlowReply> => ({ ok: true }));
    const clean = mount(flow(), { save, draft });
    expect((clean.el.querySelector('.fe-btn.primary') as HTMLButtonElement).disabled).toBe(true);
    const input = clean.el.querySelector('.fe-input') as HTMLInputElement;
    input.value = ' add a security pass ';
    input.dispatchEvent(new Event('input'));
    clean.click('.fe-ask .fe-btn');
    await clean.settle();
    expect(draft).toHaveBeenLastCalledWith('add a security pass');
    clean.click('.fe-ask .fe-btn');
    await clean.settle();
    expect(draft).toHaveBeenLastCalledWith(null);
  });

  it('saves a dirty draft; a read-only device can only look', async () => {
    const save = vi.fn(async (): Promise<McFlowReply> => ({ ok: true }));
    const dirty = mount(flow({ chain: ['ben', 'you'] }), { saved: flow(), save });
    const button = dirty.el.querySelector('.fe-btn.primary') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Save flow');
    button.click();
    await dirty.settle();
    expect(save).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const locked = mount(flow({ chain: ['ben', 'you'] }), { saved: flow(), readOnly: true });
    expect((locked.el.querySelector('.fe-btn.primary') as HTMLButtonElement).disabled).toBe(true);
    expect((locked.el.querySelector('.fe-plus') as HTMLButtonElement).disabled).toBe(true);
    expect((locked.el.querySelector('.fe-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows Paul’s reason on his draft with an undo, and resets to the standard flow', async () => {
    const { el, ops, state, click, settle } = mount(flow({ chain: ['ben', 'tessa', 'you'] }), { reason: 'A security pass fits an auth change.' });
    expect(text(el)).toContain('Paul drafted this flow');
    expect(text(el)).toContain('A security pass fits an auth change.');
    click('.fe-paul .fe-link');
    expect(state.undoDraft).toHaveBeenCalled();
    click('.fe-buttons .fe-link');
    await settle();
    expect(ops).toEqual([{ op: 'reset' }]);
  });
});
