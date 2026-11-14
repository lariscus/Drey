// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FlowStepView } from '../../../../packages/tickets-engine/src/contracts/flow';
import type { FlowDraft } from './flow-model';
import { mountFlow, type FlowDeps } from './flow-view';

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

const base: FlowDraft = {
  ok: true,
  ticket: 'T-0130',
  title: 'Voice capture',
  scope: { kind: 'ticket' },
  chain: ['ben', 'ralf'],
  saved: ['ben', 'ralf'],
  steps: [step(0, 'ben', { state: 'current', locked: true, model: 'sonnet' }), step(1, 'ralf')],
  personas: [
    { id: 'ben', kind: 'agent', title: 'Ben', color: '#6aa', model: 'sonnet' },
    { id: 'ralf', kind: 'agent', title: 'Ralf', color: '#a6a', model: 'opus' },
    { id: 'you', kind: 'human', title: 'You', color: '#aaa', model: '' },
  ],
  readOnly: null,
};
const edited: FlowDraft = { ...base, chain: ['ben', 'ralf', 'you'], steps: [...base.steps, step(2, 'you', { owner: true })] };

function setup(replies: Record<string, unknown>, ticketId = 'T-0130'): { host: HTMLElement; invoke: ReturnType<typeof vi.fn>; dispose: () => void } {
  const invoke = vi.fn((method: string) => Promise.resolve(replies[method]));
  const deps: FlowDeps = { invoke, subscribe: () => () => undefined, titleOf: () => null };
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = mountFlow(deps, host, { ticketId, part: null });
  return { host, invoke, dispose };
}

const buttonNamed = (host: HTMLElement, name: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('Flow tab on the default flow (E10-5b)', () => {
  const standard: FlowDraft = { ...base, ticket: 'standard', title: 'Default flow', scope: { kind: 'standard' }, steps: [step(0, 'ben'), step(1, 'ralf')] };

  it('asks the engine for the standard flow, names it and offers no reset to itself', async () => {
    const { host, invoke } = setup({ flow: standard, flowSave: { ok: true } }, 'standard');
    await settle();
    expect(invoke).toHaveBeenCalledWith('flow', { id: 'standard', part: null });
    expect(host.querySelector('.flow-id')?.textContent).toBe('Default flow');
    expect(host.querySelector('.flow-h')?.textContent).toBe('Default flow');
    expect(buttonNamed(host, 'Reset to standard flow').hidden).toBe(true);
    expect(buttonNamed(host, 'Save flow').title).toBe('Write this flow as the default for new tickets');
  });
});

describe('Flow tab', () => {
  it('lists the positions the engine answers, with the step-count chip', async () => {
    const { host, invoke } = setup({ flow: base });
    await settle();
    expect(invoke).toHaveBeenCalledWith('flow', { id: 'T-0130', part: null });
    expect([...host.querySelectorAll('.flow-gate-title')].map((n) => n.textContent)).toEqual(['Ben', 'Ralf']);
    expect(host.querySelector('.flow-chip')?.textContent).toBe('2 steps');
    expect(buttonNamed(host, 'Save flow').disabled).toBe(true);
  });

  it('adds a persona through the engine and saves the resulting chain', async () => {
    const { host, invoke } = setup({ flow: base, flowEdit: edited, flowSave: { ok: true } });
    await settle();
    (host.querySelectorAll('.flow-plus')[1] as HTMLButtonElement).click();
    const chips = [...host.querySelectorAll<HTMLButtonElement>('.flow-add .flow-chipbtn')];
    chips.find((c) => c.textContent === 'You')!.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('flowEdit', { id: 'T-0130', part: null, chain: ['ben', 'ralf'], edit: { op: 'insert', persona: 'you', after: 1 } });
    expect(host.querySelector('.flow-chip')?.textContent).toBe('3 steps · not saved');
    const save = buttonNamed(host, 'Save flow');
    expect(save.disabled).toBe(false);
    save.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('flowSave', { id: 'T-0130', part: null, chain: ['ben', 'ralf', 'you'] });
  });

  it('shows a refusal under the list and keeps the draft', async () => {
    const { host } = setup({ flow: base, flowEdit: { ok: false, error: 'position 1 is the current step' } });
    await settle();
    (host.querySelectorAll('.flow-plus')[0] as HTMLButtonElement).click();
    buttonNamed(host, 'You').click();
    await settle();
    expect(host.querySelector('.flow-message')?.textContent).toBe('position 1 is the current step');
    expect(host.querySelector('.flow-chip')?.textContent).toBe('2 steps');
  });

  it('reports a read-only flow and a failed load', async () => {
    const ro = setup({ flow: { ...base, readOnly: 'A run is live on this ticket' } });
    await settle();
    expect(ro.host.textContent).toContain('A run is live on this ticket');
    expect((ro.host.querySelector('.flow-plus') as HTMLButtonElement).disabled).toBe(true);
    const failed = setup({ flow: { ok: false, error: 'no such ticket' } });
    await settle();
    expect(failed.host.querySelector('.flow-note')?.textContent).toBe('no such ticket');
  });
});
