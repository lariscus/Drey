import { describe, expect, it } from 'vitest';
import type { FlowStepView } from '../../../../packages/tickets-engine/src/contracts/flow';
import {
  addablePersonasOf,
  changedIndicesOf,
  changesLabelOf,
  eyebrowOf,
  flowKeyOf,
  flowTargetOfKey,
  flowTitleOf,
  isDirty,
  marksOf,
  moveRoomOf,
  personasFor,
  runsAfterOf,
  whoOf,
  humanNameOf,
  type FlowDraft,
} from './flow-model';

const step = (index: number, persona: string, extra: Partial<FlowStepView> = {}): FlowStepView => ({
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

const flow = (extra: Partial<FlowDraft> = {}): FlowDraft => ({
  ok: true,
  ticket: 'T-0130',
  title: 'Voice capture',
  scope: { kind: 'ticket' },
  chain: ['ben', 'ralf', 'tessa', 'you'],
  saved: ['ben', 'ralf', 'tessa', 'you'],
  steps: [
    step(0, 'ben', { state: 'current', model: 'sonnet', locked: true }),
    step(1, 'ralf', { model: 'opus' }),
    step(2, 'tessa'),
    step(3, 'you', { owner: true, title: 'You' }),
  ],
  personas: [
    { id: 'ben', kind: 'agent', title: 'Ben', color: '#6aa', model: 'sonnet' },
    { id: 'ralf', kind: 'agent', title: 'Ralf', color: '#a6a', model: 'opus' },
    { id: 'you', kind: 'human', title: 'You', color: '#aaa', model: '' },
  ],
  readOnly: null,
  ...extra,
});

describe('flow model', () => {
  it('words the chip and the eyebrow', () => {
    expect(changesLabelOf(['paul'])).toBe('1 step');
    expect(changesLabelOf(['a', 'b'])).toBe('2 steps');
    expect(eyebrowOf(flow())).toBe('Flow');
    expect(eyebrowOf(flow({ scope: { kind: 'part', index: 1, title: 'Backend' } }))).toBe('Flow · Part 2');
  });

  it('is dirty only when the chain differs from the saved one', () => {
    expect(isDirty(flow(), flow())).toBe(false);
    expect(isDirty(flow({ chain: ['ben', 'you'] }), flow())).toBe(true);
    expect(isDirty(null, flow())).toBe(false);
  });

  it('marks the positions the draft changed against the saved flow', () => {
    const draft = flow({ steps: [...flow().steps, step(4, 'ralf')] });
    expect([...changedIndicesOf(draft, flow())]).toEqual([4]);
    expect(changedIndicesOf(draft, null).size).toBe(0);
    const swapped = flow({ steps: flow().steps.map((s) => (s.index === 2 ? { ...s, persona: 'ralf' } : s)) });
    expect([...changedIndicesOf(swapped, flow())]).toEqual([2]);
    const notified = flow({ steps: flow().steps.map((s) => (s.index === 1 ? { ...s, notify: true } : s)) });
    expect([...changedIndicesOf(notified, flow())]).toEqual([1]);
    // an added persona in the middle marks only itself, not every position after it
    const inserted = flow({ steps: [step(0, 'ben'), step(1, 'ralf'), step(2, 'tessa'), step(3, 'paul'), step(4, 'you', { owner: true })] });
    expect([...changedIndicesOf(inserted, flow())]).toEqual([3]);
  });

  it('names who works a position', () => {
    const f = flow();
    expect(whoOf(f.steps[0]!, f)).toBe('Ben');
    expect(whoOf(f.steps[3]!, f)).toBe('You');
    expect(whoOf(step(9, 'ghost', { missing: true, title: 'ghost' }), f)).toBe('ghost');
  });

  it('shows the owner under the configured name of the human persona', () => {
    const f = flow({ personas: [{ id: 'you', kind: 'human', title: 'Henrik', color: '#999999', model: '' }] });
    expect(whoOf(step(9, 'you', { owner: true }), f)).toBe('Henrik');
    expect(humanNameOf(f)).toBe('Henrik');
    expect(humanNameOf({ personas: [] })).toBe('You');
  });

  it('lists the marks of a position', () => {
    expect(marksOf(step(1, 'ben', { notify: true }))).toEqual(['Tell me']);
    expect(marksOf(step(0, 'paul', { mode: 'shape', notify: true }))).toEqual(['Shape', 'Tell me']);
    expect(marksOf(step(1, 'ben'))).toEqual([]);
  });

  it('finds the gate before and the room to move', () => {
    const f = flow();
    expect(runsAfterOf(f, f.steps[0]!)).toBeNull();
    expect(runsAfterOf(f, f.steps[2]!)?.persona).toBe('ralf');
    expect(moveRoomOf(f, f.steps[0]!)).toEqual({ earlier: false, later: false });
    expect(moveRoomOf(f, f.steps[1]!)).toEqual({ earlier: false, later: true });
    expect(moveRoomOf(f, f.steps[2]!)).toEqual({ earlier: true, later: true });
    expect(moveRoomOf(f, f.steps[3]!)).toEqual({ earlier: true, later: false });
  });

  it('offers the whole crew to add and to give', () => {
    const f = flow();
    expect(addablePersonasOf(f).map((p) => p.id)).toEqual(['ben', 'ralf', 'you']);
    expect(personasFor(f).map((p) => p.id)).toEqual(['ben', 'ralf', 'you']);
  });

  it('round-trips the tab key', () => {
    expect(flowKeyOf({ ticketId: 'T-0130', part: null })).toBe('flow://T-0130');
    expect(flowKeyOf({ ticketId: 'T-0130', part: 2 })).toBe('flow://T-0130/2');
    expect(flowTargetOfKey('flow://T-0130/2')).toEqual({ ticketId: 'T-0130', part: 2 });
    expect(flowTargetOfKey('flow://T-0130')).toEqual({ ticketId: 'T-0130', part: null });
    expect(flowTargetOfKey('flow://standard')).toEqual({ ticketId: 'standard', part: null });
    expect(flowTargetOfKey('review://T-0130')).toBeNull();
    expect(flowTitleOf({ ticketId: 'T-0130', part: 0 })).toBe('Flow · T-0130 · Part 1');
    expect(flowTitleOf({ ticketId: 'standard', part: null })).toBe('Flow · Default');
  });
});
