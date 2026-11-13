// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { ModelsReply, SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { createModelsSection } from './models-section';

const slot = (id: string, label: string, extra: Partial<SlotView> = {}): SlotView => ({
  id,
  label,
  provider: 'claude-code',
  billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' },
  quota: 'claude-code',
  state: 'ready',
  busy: 0,
  total: 2,
  windows: [{ name: '5h', spanMs: null, remaining: 0.78, resetsAt: null, reliability: 'measured', fetchedAt: null }],
  q: 1.4,
  reason: null,
  lastFetch: null,
  lastFetchError: null,
  implied: false,
  ...extra,
});

const models: ModelsReply = {
  ok: true,
  models: [
    { model: 'claude-opus-4-1', slot: 'a', provider: 'claude-code', category: 'frontier', class: 'A', cost: 5, sessions: 1 },
    { model: 'gpt-5.4', slot: 'w', provider: 'opencode', category: 'everyday', class: 'B', cost: 1, sessions: 2 },
  ],
  capacity: { global: 6, perSlot: {} },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
  now: { used: 2.4, global: 6, slots: [{ id: 'a', label: 'Claude A', used: 2, cap: 5, derived: true }] },
  queue: [],
  providerDay: [],
  errors: [],
  configPath: 'service.json',
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function setup(poolReply: ModelsReply | null = models) {
  const invoke = vi.fn((method: string, payload?: unknown): Promise<unknown> => {
    if (method === 'poolModels') {
      return Promise.resolve(poolReply);
    }
    if (method === 'slots') {
      return Promise.resolve({ ok: true, slots: [slot('a', 'Claude A'), slot('w', 'Copilot', { provider: 'opencode', windows: [] })], configPath: '' });
    }
    if (method === 'poolModelsConfig') {
      return Promise.resolve({ ...models, ...(payload as object) });
    }
    return Promise.resolve(undefined);
  });
  const api = { i18n, backend: { invoke }, ui: { icon: () => document.createElement('span') } } as unknown as DreyPluginApi;
  const section = createModelsSection(api);
  document.body.replaceChildren(section.root);
  return { section, invoke };
}

const writes = (invoke: ReturnType<typeof vi.fn>): unknown[] => invoke.mock.calls.filter(([method]) => method === 'poolModelsConfig').map(([, payload]) => payload);

describe('Settings → Models page', () => {
  it('draws the five groups in the board order under the section anchor', async () => {
    const { section } = setup();
    await section.refresh();
    expect(section.root.querySelector('[data-settings-section="models"] h3')?.textContent).toBe('Models');
    expect([...section.root.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Model table', 'Capacity', 'Slots', 'Routing', 'Ledgers']);
  });

  it('fills the table', async () => {
    const { section } = setup();
    await section.refresh();
    const rows = [...section.root.querySelectorAll('tbody tr')];
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent).join('|'))).toEqual(['claude-opus-4-1|Claude A|frontier|A|5|1', 'gpt-5.4|Copilot|everyday|B|1|2']);
    expect(section.root.querySelectorAll('thead th')).toHaveLength(6);
  });

  it('shows the caps, the live line and the ledger defaults', async () => {
    const { section } = setup();
    await section.refresh();
    const input = (label: string): HTMLInputElement => section.root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(input('Global cap').value).toBe('6');
    expect(section.root.textContent).toContain('Now: 2.4 of 6 · Claude A 2 of 5');
    expect(input('Ticket allowance').value).toBe('$2.50');
    expect(input('Persona per day').value).toBe('$5.00');
    expect(input('Provider per day').value).toBe('$15.00');
  });

  it('follows the chain status for the live load', async () => {
    const { section } = setup();
    await section.refresh();
    section.update({ pool: { used: 3, global: 6, slots: [{ id: 'a', label: 'Claude A', used: 3, cap: 5, derived: true }] } } as never);
    expect(section.root.textContent).toContain('Now: 3 of 6 · Claude A 3 of 5');
  });

  it('draws one card per slot, and the routing fields with the engine values', async () => {
    const { section } = setup({ ...models, routing: { upgradeAboveQ: 1.5, reservePerWindow: 0.15, burnRate: 0.25 } });
    await section.refresh();
    expect([...section.root.querySelectorAll('.tset-models-cardname')].map((n) => n.textContent)).toEqual(['Claude A', 'Copilot']);
    expect(section.root.querySelector('.tset-models-card')?.textContent).toContain('78 % left');
    const routing = ['Upgrade above q', 'Reserve per window', 'Burn rate'].map((label) => section.root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!);
    expect(routing.map((i) => [i.value, i.readOnly, i.disabled])).toEqual([['1.5', false, false], ['15', false, false], ['25', false, false]]);
    expect(section.root.textContent).toContain('A session gets exactly its class or waits. Never a smaller class.');
    expect(section.root.querySelectorAll<HTMLElement>('.tset-models-error')[1]?.hidden).toBe(true);
  });

  it('writes a routing field on change (blur or Enter) as the whole routing key', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const burn = section.root.querySelector<HTMLInputElement>('input[aria-label="Burn rate"]')!;
    burn.value = '30';
    burn.dispatchEvent(new Event('change'));
    await settle();
    expect(writes(invoke)).toEqual([{ routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.3 } }]);
    expect(burn.value).toBe('30');
    const q = section.root.querySelector<HTMLInputElement>('input[aria-label="Upgrade above q"]')!;
    q.value = '';
    q.dispatchEvent(new Event('change'));
    await settle();
    expect(writes(invoke)[1]).toEqual({ routing: { upgradeAboveQ: null, reservePerWindow: 0.1, burnRate: 0.3 } });
  });

  it('refuses a value the engine would refuse, says why under the group and writes nothing', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const reserve = section.root.querySelector<HTMLInputElement>('input[aria-label="Reserve per window"]')!;
    reserve.value = '120';
    reserve.dispatchEvent(new Event('change'));
    await settle();
    expect(writes(invoke)).toEqual([]);
    expect(reserve.getAttribute('aria-invalid')).toBe('true');
    const note = section.root.querySelectorAll<HTMLElement>('.tset-models-error')[1]!;
    expect([note.hidden, note.textContent]).toEqual([false, 'A share from 0 to below 100 %.']);
  });

  it('shows the engine refusal (422) under the Routing group', async () => {
    const { section, invoke } = setup();
    invoke.mockImplementation((method: string) => {
      if (method === 'poolModelsConfig') {
        return Promise.resolve({ ok: false, error: 'routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)' });
      }
      return method === 'poolModels' ? Promise.resolve(models) : Promise.resolve({ ok: true, slots: [] });
    });
    await section.refresh();
    const burn = section.root.querySelector<HTMLInputElement>('input[aria-label="Burn rate"]')!;
    burn.value = '50';
    burn.dispatchEvent(new Event('change'));
    await settle();
    const note = section.root.querySelectorAll<HTMLElement>('.tset-models-error')[1]!;
    expect(note.textContent).toBe('routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)');
    expect(burn.getAttribute('aria-invalid')).toBe('true');
    expect(section.root.querySelector<HTMLElement>('.tset-models-error')?.hidden).toBe(true);
  });

  it('writes the global cap, keeping the per-slot caps', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const cap = section.root.querySelector<HTMLInputElement>('input[aria-label="Global cap"]')!;
    cap.value = '8';
    cap.dispatchEvent(new Event('change'));
    await settle();
    expect(writes(invoke)).toEqual([{ capacity: { global: 8, perSlot: {} } }]);
  });

  it('refuses a cap that is not a number and writes nothing', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const cap = section.root.querySelector<HTMLInputElement>('input[aria-label="Global cap"]')!;
    cap.value = 'many';
    cap.dispatchEvent(new Event('change'));
    await settle();
    expect(cap.getAttribute('aria-invalid')).toBe('true');
    expect(writes(invoke)).toEqual([]);
  });

  it('writes one ledger default and keeps the others; an empty field clears it', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const field = section.root.querySelector<HTMLInputElement>('input[aria-label="Provider per day"]')!;
    field.value = '';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(writes(invoke)).toEqual([{ ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: null } }]);
  });

  it('edits a cell in place and sends the whole table', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const cost = section.root.querySelectorAll('tbody tr')[0]!.querySelector<HTMLElement>('.tset-models-c-cost')!;
    cost.click();
    const field = cost.querySelector<HTMLInputElement>('input')!;
    field.value = '4';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    const sent = writes(invoke)[0] as { models: { model: string; cost: number }[] };
    expect(sent.models.map((m) => [m.model, m.cost])).toEqual([['claude-opus-4-1', 4], ['gpt-5.4', 1]]);
  });

  it('adds a model through a draft row and drops it on Escape', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const add = [...section.root.querySelectorAll('button')].find((b) => b.textContent === 'Add model…')!;
    add.click();
    const draft = section.root.querySelector('.tset-models-draft')!;
    const [name] = draft.querySelectorAll<HTMLInputElement>('input');
    name!.value = 'kimi-k2.5';
    name!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    const sent = writes(invoke)[0] as { models: { model: string }[] };
    expect(sent.models.map((m) => m.model)).toEqual(['claude-opus-4-1', 'gpt-5.4', 'kimi-k2.5']);

    add.click();
    section.root.querySelector('.tset-models-draft input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(section.root.querySelector('.tset-models-draft')).toBeNull();
  });

  it('Add slot… adds a row that Enter sends as one slot, and draws the slots the engine answers (D-69)', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    invoke.mockImplementationOnce(() => Promise.resolve({ ok: true, slots: [slot('a', 'Claude A'), slot('claude-b', 'Claude B')] }));
    [...section.root.querySelectorAll('button')].find((b) => b.textContent === 'Add slot…')!.click();
    expect(invoke).not.toHaveBeenCalledWith('serviceOpenLogFolder');
    const draft = section.root.querySelector('.tset-models-slotdraft')!;
    const name = draft.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    const [provider] = draft.querySelectorAll('select');
    name.value = 'Claude B';
    provider!.value = 'claude-code';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(invoke).toHaveBeenCalledWith('slotAdd', { slot: { id: 'claude-b', label: 'Claude B', provider: 'claude-code' } });
    expect([...section.root.querySelectorAll('.tset-models-cardname')].map((n) => n.textContent)).toEqual(['Claude A', 'Claude B']);
    expect(section.root.querySelector('.tset-models-slotdraft')).toBeNull();
  });

  it('every slot card has a remove control that sends its id; a refusal shows under the slots (D-69)', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    const removes = [...section.root.querySelectorAll<HTMLButtonElement>('.tset-models-card .tset-models-slotremove')];
    expect(removes.map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Claude A', 'Remove Copilot']);
    invoke.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'slot "a" runs claude-opus-4-1 in the model table: move or remove those rows first' }));
    removes[0]!.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('slotRemove', { id: 'a' });
    expect(section.root.querySelector('.tset-models-addslot .tset-error')?.textContent).toContain('runs claude-opus-4-1');
    invoke.mockImplementationOnce(() => Promise.resolve({ ok: true, slots: [slot('a', 'Claude A')] }));
    section.root.querySelectorAll<HTMLButtonElement>('.tset-models-slotremove')[1]!.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('slotRemove', { id: 'w' });
    expect([...section.root.querySelectorAll('.tset-models-cardname')].map((n) => n.textContent)).toEqual(['Claude A']);
  });

  it('a name with nothing an id can hold is not sent', async () => {
    const { section, invoke } = setup();
    await section.refresh();
    [...section.root.querySelectorAll('button')].find((b) => b.textContent === 'Add slot…')!.click();
    const name = section.root.querySelector<HTMLInputElement>('.tset-models-slotdraft input')!;
    name.value = ' ** ';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(invoke.mock.calls.some(([method]) => method === 'slotAdd')).toBe(false);
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(section.root.querySelector('.tset-models-slotdraft')).toBeNull();
  });

  it('says so when no runner is awake and leaves every field disabled', async () => {
    const { section } = setup(null);
    await section.refresh();
    expect(section.root.querySelector('.tset-models-error')?.textContent).toBe('The runner is not awake, so the model table cannot be read.');
    expect(section.root.querySelector<HTMLInputElement>('input[aria-label="Global cap"]')!.disabled).toBe(true);
  });
});
