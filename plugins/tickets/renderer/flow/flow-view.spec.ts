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

  it("opens a gate's menu from the row — run as, tell me, moves, remove — and removes from it", async () => {
    const { host, invoke, dispose } = setup({ flow: base, flowEdit: { ...base, chain: ['ben'] }, flowSave: { ok: true } });
    await settle();
    (host.querySelectorAll('.flow-gate')[1] as HTMLButtonElement).click();
    const menu = document.querySelector('.flow-gate-menu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    const labels = [...menu.querySelectorAll('.tickets-menu-item .tickets-menu-label')].map((n) => n.textContent);
    expect(labels).toContain('Ralf');
    expect(labels).toContain('Tell me when it is done');
    expect(labels).toContain('Move earlier');
    expect(labels).toContain('Move later');
    expect(labels).toContain('Remove this gate');
    // The gate's own persona is ticked.
    const ralf = [...menu.querySelectorAll('.tickets-menu-item')].find((n) => n.querySelector('.tickets-menu-label')?.textContent === 'Ralf')!;
    expect(ralf.querySelector('.tickets-menu-check')?.textContent).toBe('✓');
    // Remove goes through the same engine round trip as the old sidebar's button.
    const remove = [...menu.querySelectorAll<HTMLButtonElement>('.tickets-menu-item')].find((n) => n.querySelector('.tickets-menu-label')?.textContent === 'Remove this gate')!;
    remove.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('flowEdit', { id: 'T-0130', part: null, chain: ['ben', 'ralf'], edit: { op: 'remove', step: 1 } });
    expect(document.querySelector('.flow-gate-menu')).toBeNull();
    dispose();
  });

  it('shows the engine rules as disabled rows with their reason instead of refusals', async () => {
    const shaped: FlowDraft = {
      ...base,
      steps: [step(0, 'paul', { mode: 'shape' }), step(1, 'ralf')],
      personas: [
        { id: 'paul', kind: 'agent', title: 'Paul', color: '#f2d3e2', model: 'sonnet' },
        { id: 'pia', kind: 'mission', title: 'Pia', color: '#d9cff5', model: '' },
        { id: 'you', kind: 'human', title: 'Henrik', color: '#38bdf8', model: '' },
      ],
    };
    const { host, dispose } = setup({ flow: shaped });
    await settle();
    (host.querySelectorAll('.flow-gate')[0] as HTMLButtonElement).click();
    const menu = document.querySelector('.flow-gate-menu')!;
    const byLabel = (label: string): HTMLButtonElement =>
      [...menu.querySelectorAll<HTMLButtonElement>('.tickets-menu-item')].find((n) => n.querySelector('.tickets-menu-label')?.textContent === label)!;
    // A mode-carrying position can only be taken by an agent persona.
    expect(byLabel('Pia').disabled).toBe(true);
    expect(byLabel('Pia').title).toBe('only an agent persona can run the shape step');
    expect(byLabel('Henrik').disabled).toBe(true);
    expect(byLabel('Paul').disabled).toBe(false);
    expect(byLabel('Paul').querySelector('.tickets-menu-check')?.textContent).toBe('✓');
    dispose();
  });

  it("the current gate's menu keeps the tell-me rule and refuses the rest with the reason", async () => {
    const { host, dispose } = setup({ flow: base });
    await settle();
    (host.querySelectorAll('.flow-gate')[0] as HTMLButtonElement).click();
    const menu = document.querySelector('.flow-gate-menu')!;
    const byLabel = (label: string): HTMLButtonElement =>
      [...menu.querySelectorAll<HTMLButtonElement>('.tickets-menu-item')].find((n) => n.querySelector('.tickets-menu-label')?.textContent === label)!;
    expect(byLabel('Remove this gate').disabled).toBe(true);
    expect(byLabel('Remove this gate').title).toBe('the current step stays as it is');
    expect(byLabel('Move earlier').disabled).toBe(true);
    // The engine allows the current step's tell-me rule to change.
    expect(byLabel('Tell me when it is done').disabled).toBe(false);
    dispose();
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
