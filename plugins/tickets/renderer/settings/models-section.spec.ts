// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { createModelsSection } from './models-section';
import { pool, slots } from './models-fixtures';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

function setup(poolReply: ModelsReply | null = pool) {
  const invoke = vi.fn((method: string, payload?: unknown): Promise<unknown> => {
    switch (method) {
      case 'poolModels':
        return Promise.resolve(poolReply);
      case 'slots':
        return Promise.resolve({ ok: true, slots, configPath: '' });
      case 'poolModelsConfig':
        return Promise.resolve({ ...pool, ...(payload as object) });
      case 'slotAdd':
      case 'slotRemove':
      case 'slotUpdate':
        return Promise.resolve({ ok: true, slots, configPath: '' });
      default:
        return Promise.resolve(pool);
    }
  });
  const api = { i18n, backend: { invoke } } as unknown as DreyPluginApi;
  const section = createModelsSection(api);
  document.body.replaceChildren(section.root);
  return { section, invoke };
}

const calls = (invoke: ReturnType<typeof vi.fn>, method: string): unknown[] => invoke.mock.calls.filter(([name]) => name === method).map(([, payload]) => payload);
const byLabel = <T extends Element>(root: ParentNode, label: string): T => root.querySelector<T>(`[aria-label="${label}"]`)!;
const text = (root: ParentNode, selector: string): string[] => [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');

describe('Settings → Models page', () => {
  it('draws the title, the cap line, then Harnesses, Classes, Accounts and Routing in the board order', async () => {
    const { section } = setup();
    await section.refresh();
    expect(section.root.querySelector('[data-settings-section="models"] h3')?.textContent).toBe('Models');
    expect(text(section.root, 'h2')).toEqual(['Harnesses', 'Classes', 'Accounts', 'Routing']);
    expect(section.root.querySelector('.mdl-caprow')?.textContent).toContain('Now 2.4 of 6');
    expect(section.root.textContent).toContain('Checked');
  });

  it('lists the harnesses, a missing one greyed with a disabled Install', async () => {
    const { section } = setup();
    await section.refresh();
    expect(text(section.root, '.mdl-harnesses .mdl-row')[1]).toContain('zai-coding-plan, github-copilot');
    const missing = section.root.querySelectorAll('.mdl-harnesses .mdl-row')[2]!;
    expect(missing.textContent).toContain('not installed');
    expect(missing.querySelector('button')?.disabled).toBe(true);
  });

  it('groups the models under their class, the new-model card above the groups', async () => {
    const { section } = setup();
    await section.refresh();
    expect(text(section.root, '.mdl-classname')).toEqual(['heavy', 'standard', 'light']);
    expect(text(section.root, '.mdl-modelid')).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'zai-coding-plan/glm-5.3']);
    expect(section.root.querySelector('.mdl-found')?.textContent).toContain('zai-coding-plan/glm-5.3-air');
    expect([...section.root.querySelectorAll<HTMLInputElement>('.mdl-sw')].map((s) => s.checked)).toEqual([true, true, false]);
  });

  it('looks for models once on first paint, without the network, when never checked', async () => {
    const never = { ...pool, discovery: { ...pool.discovery, checkedAt: null } };
    const { section, invoke } = setup(never);
    await section.refresh();
    await settle();
    expect(calls(invoke, 'poolModelsDiscover')).toEqual([{ registry: false }]);
  });

  it('does not look when it was checked before; Find models again asks the registry too', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    expect(calls(invoke, 'poolModelsDiscover')).toEqual([]);
    byLabel<HTMLButtonElement>(section.root, 'Find models again').click();
    await settle();
    expect(calls(invoke, 'poolModelsDiscover')).toEqual([{ registry: true }]);
  });

  it('moves a model by the class menu: the whole table with the row in its new class', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    byLabel<HTMLButtonElement>(section.root, 'Class of claude-sonnet-5-5').click();
    const items = [...section.root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-checked')])).toEqual([['heavy', 'false'], ['standard', 'true'], ['light', 'false']]);
    items[2]!.click();
    await settle();
    const [write] = calls(invoke, 'poolModelsConfig') as { models: { model: string; class: string }[] }[];
    expect(write!.models.map((m) => [m.model, m.class])).toEqual([
      ['claude-opus-5-5', 'heavy'],
      ['claude-sonnet-5-5', 'light'],
      ['zai-coding-plan/glm-5.3', 'standard'],
    ]);
  });

  it('moves a model by dragging its handle onto another class', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const grip = section.root.querySelectorAll<HTMLElement>('.mdl-grip')[0]!;
    grip.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const light = section.root.querySelectorAll<HTMLElement>('.mdl-class')[2]!;
    light.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    light.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    const [write] = calls(invoke, 'poolModelsConfig') as { models: { class: string }[] }[];
    expect(write!.models[0]!.class).toBe('light');
  });

  it('writes the switch, a class cap and the global cap', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    section.root.querySelectorAll<HTMLInputElement>('.mdl-sw')[2]!.click();
    await settle();
    expect((calls(invoke, 'poolModelsConfig')[0] as { models: { enabled?: boolean }[] }).models[2]!.enabled).toBeUndefined();
    const steppers = section.root.querySelectorAll<HTMLElement>('.mdl-classhead .mdl-step');
    steppers[2]!.querySelectorAll('button')[0]!.click();
    await settle();
    expect(calls(invoke, 'poolModelsConfig')[1]).toEqual({ classes: [{ name: 'heavy', sessions: 2 }, { name: 'standard', sessions: null }, { name: 'light', sessions: 5 }] });
    section.root.querySelector<HTMLElement>('.mdl-caprow .mdl-step')!.querySelectorAll('button')[1]!.click();
    await settle();
    expect(calls(invoke, 'poolModelsConfig')[2]).toEqual({ capacity: { global: 7, perSlot: {} } });
  });

  it('adds a found model to the picked class, or ignores it', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const card = section.root.querySelector<HTMLElement>('.mdl-found')!;
    expect(card.querySelector('select')?.value).toBe('light');
    card.querySelectorAll('button')[0]!.click();
    await settle();
    expect(calls(invoke, 'poolModelAdd')).toEqual([{ provider: 'opencode', model: 'zai-coding-plan/glm-5.3-air', class: 'light' }]);
    section.root.querySelectorAll<HTMLElement>('.mdl-found')[0]!.querySelectorAll('button')[1]!.click();
    await settle();
    expect(calls(invoke, 'poolModelIgnore')).toEqual([{ provider: 'opencode', model: 'zai-coding-plan/glm-5.3-air' }]);
  });

  it('adds a class above another, writing the whole class list', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    [...section.root.querySelectorAll<HTMLButtonElement>('.mdl-grouphead button')].find((b) => b.textContent === 'Add class')!.click();
    const box = section.root.querySelector<HTMLElement>('.mdl-addbox')!;
    const name = box.querySelector<HTMLInputElement>('input')!;
    name.value = 'Super Heavy';
    name.dispatchEvent(new Event('input'));
    const where = box.querySelector<HTMLSelectElement>('select')!;
    where.value = 'heavy';
    where.dispatchEvent(new Event('change'));
    [...box.querySelectorAll('button')].find((b) => b.textContent === 'Add')!.click();
    await settle();
    expect(calls(invoke, 'poolModelsConfig')[0]).toEqual({ classes: [{ name: 'super heavy', sessions: null }, { name: 'heavy', sessions: 2 }, { name: 'standard', sessions: null }, { name: 'light', sessions: 6 }] });
  });

  it('edits an account cost in place: one slotUpdate with the billing', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const first = section.root.querySelector<HTMLElement>('.mdl-account')!;
    const amount = first.querySelector<HTMLInputElement>('.mdl-amountfield')!;
    amount.value = '95';
    amount.dispatchEvent(new Event('change'));
    await settle();
    expect(calls(invoke, 'slotUpdate')).toEqual([{ id: 'a', patch: { billing: { kind: 'subscription', pricePerMonth: 95, currency: 'EUR' } } }]);
    const kind = first.querySelector<HTMLSelectElement>('select')!;
    kind.value = 'credits';
    kind.dispatchEvent(new Event('change'));
    await settle();
    expect(calls(invoke, 'slotUpdate')[1]).toEqual({ id: 'a', patch: { billing: { kind: 'credits', pricePerCredit: 95, currency: 'EUR' } } });
  });

  it('sets the sessions of an account with the stepper', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    section.root.querySelector<HTMLElement>('.mdl-account .mdl-step')!.querySelectorAll('button')[1]!.click();
    await settle();
    expect(calls(invoke, 'slotUpdate')).toEqual([{ id: 'a', patch: { sessions: 3 } }]);
  });

  it('asks inside the row before removing an account, and takes the models along that run only on it', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    byLabel<HTMLButtonElement>(section.root.querySelectorAll<HTMLElement>('.mdl-account')[0]!, 'Remove account').click();
    const ask = section.root.querySelector<HTMLElement>('.mdl-confirm')!;
    expect(ask.textContent).toContain('Remove Claude A? 2 models use only this account.');
    [...ask.querySelectorAll('button')].find((b) => b.textContent === 'Keep')!.click();
    expect(section.root.querySelector('.mdl-confirm')).toBeNull();
    byLabel<HTMLButtonElement>(section.root.querySelectorAll<HTMLElement>('.mdl-account')[0]!, 'Remove account').click();
    [...section.root.querySelector('.mdl-confirm')!.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!.click();
    await settle();
    expect(calls(invoke, 'slotRemove')).toEqual([{ id: 'a', withModels: true }]);
  });

  it('adds an account from the inline row', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    [...section.root.querySelectorAll<HTMLButtonElement>('.mdl-grouphead button')].find((b) => b.textContent === 'Add account')!.click();
    const box = section.root.querySelector<HTMLElement>('.mdl-addbox')!;
    const label = box.querySelector<HTMLInputElement>('input')!;
    label.value = 'Claude C';
    label.dispatchEvent(new Event('input'));
    const amount = box.querySelector<HTMLInputElement>('.mdl-amountfield')!;
    amount.value = '90';
    amount.dispatchEvent(new Event('change'));
    [...box.querySelectorAll('button')].find((b) => b.textContent === 'Add')!.click();
    await settle();
    expect(calls(invoke, 'slotAdd')).toEqual([
      { slot: { id: 'claude-c', label: 'Claude C', provider: 'claude-code', billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, sessions: 1 } },
    ]);
  });

  it('folds the routing: the summary line closed, the fields and ledgers open', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const fold = section.root.querySelector<HTMLButtonElement>('.mdl-fold')!;
    expect(fold.textContent).toContain('step up above q 1.3 · reserve 10 % · burn rate 80 %');
    expect(section.root.querySelector('.mdl-fields')).toBeNull();
    fold.click();
    const burn = byLabel<HTMLInputElement>(section.root, 'Burn rate');
    expect(burn.value).toBe('80');
    burn.value = '60';
    burn.dispatchEvent(new Event('change'));
    await settle();
    expect(calls(invoke, 'poolModelsConfig')).toEqual([{ routing: { ...pool.routing, burnRate: 0.6 } }]);
    expect(byLabel<HTMLInputElement>(section.root, 'Ticket allowance').value).toBe('$2.50');
  });

  it('says so when the runner is not awake', async () => {
    const { section } = setup(null);
    await section.refresh();
    expect(section.root.textContent).toContain('The runner is not awake');
    expect(section.root.querySelector('.mdl-class')).toBeNull();
  });

  it('a sleeping runner: Find models again stays on, wakes it, and the accounts are read then', async () => {
    let awake = false;
    const invoke = vi.fn((method: string): Promise<unknown> => {
      if (method === 'poolModelsDiscover') {
        awake = true;
        return Promise.resolve({ ...pool, registryError: 'the registry answered nothing' });
      }
      if (method === 'slots') {
        return Promise.resolve(awake ? { ok: true, slots, configPath: '' } : null);
      }
      return Promise.resolve(awake ? pool : null);
    });
    const section = createModelsSection({ i18n, backend: { invoke } } as unknown as DreyPluginApi);
    document.body.replaceChildren(section.root);
    await section.refresh();
    const again = byLabel<HTMLButtonElement>(section.root, 'Find models again');
    expect(again.disabled).toBe(false);
    again.click();
    await settle();
    await settle();
    expect(section.root.querySelectorAll('.mdl-account').length).toBe(slots.length);
    expect(section.root.querySelector('.mdl-note')?.textContent).toBe('the registry answered nothing');
  });

  it('shows the engine refusal of a write', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    invoke.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'classes needs a name' }));
    section.root.querySelectorAll<HTMLInputElement>('.mdl-sw')[0]!.click();
    await settle();
    expect(section.root.querySelector('.mdl-note')?.textContent).toBe('classes needs a name');
  });
});
