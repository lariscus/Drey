import type { DiscoveryReport, ModelRow, ModelsReply, SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol';

/** Sample answers shared by the Models page's specs (board 7l v3, trimmed). */
export const row = (extra: Partial<ModelRow> & Pick<ModelRow, 'model'>): ModelRow => ({
  slot: null,
  provider: 'claude-code',
  category: 'everyday',
  class: 'standard',
  cost: 1,
  enabled: true,
  ...extra,
});

export const slot = (extra: Partial<SlotView> & Pick<SlotView, 'id' | 'label'>): SlotView => ({
  provider: 'claude-code',
  billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' },
  quota: 'claude-code',
  state: 'ready',
  busy: 0,
  total: 2,
  windows: [],
  q: null,
  reason: null,
  lastFetch: null,
  lastFetchError: null,
  implied: false,
  ...extra,
});

export const discovery: DiscoveryReport = {
  checkedAt: '2026-11-13T10:00:00.000Z',
  running: false,
  harnesses: [
    { provider: 'claude-code', label: 'Claude Code', version: '2.1.319', state: 'signed-in', providers: [], models: 2, error: null },
    { provider: 'opencode', label: 'opencode', version: '2.0.32', state: 'signed-in', providers: ['zai-coding-plan', 'github-copilot'], models: 1, error: null },
    { provider: 'copilot', label: 'Copilot CLI', version: null, state: 'not-installed', providers: [], models: 0, error: null },
  ],
  found: [{ model: 'zai-coding-plan/glm-5.3-air', provider: 'opencode', slot: 'zai', name: null, capabilities: {}, suggested: 'light' }],
  ignored: [],
};

export const pool: ModelsReply = {
  ok: true,
  classes: [
    { name: 'heavy', sessions: 2 },
    { name: 'standard', sessions: null },
    { name: 'light', sessions: 6 },
  ],
  models: [
    row({ model: 'claude-opus-5-5', slot: 'a', class: 'heavy', cost: 5, tools: true, input: ['text', 'image'], context: 1_000_000 }),
    row({ model: 'claude-sonnet-5-5', slot: 'a', class: 'standard', cost: 1, tools: true, context: 200_000 }),
    row({ model: 'zai-coding-plan/glm-5.3', slot: 'zai', provider: 'opencode', class: 'standard', cost: 0.4, enabled: false, context: 128_000 }),
  ],
  capacity: { global: 6, perSlot: {} },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.8 },
  now: {
    used: 2.4,
    global: 6,
    slots: [{ id: 'a', label: 'Claude A', used: 2, cap: 5 }],
    classes: [
      { name: 'heavy', busy: 1, cap: 2 },
      { name: 'standard', busy: 2, cap: null },
      { name: 'light', busy: 0, cap: 6 },
    ],
  },
  queue: [],
  providerDay: [],
  errors: [],
  configPath: 'service.json',
  discovery,
};

export const slots: readonly SlotView[] = [
  slot({ id: 'a', label: 'Claude A', windows: [{ name: '5h', spanMs: null, remaining: 0.78, resetsAt: null, reliability: 'measured', fetchedAt: null }] }),
  slot({ id: 'zai', label: 'z.ai', provider: 'opencode', total: 3, billing: { kind: 'subscription', pricePerMonth: 15, currency: 'EUR' } }),
  slot({ id: 'cp', label: 'Copilot', provider: 'opencode', billing: { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' } }),
];
