import { describe, expect, it } from 'vitest';
import type { DiscoveredModel, ModelRow, PoolSettings } from '../protocol';
import { DEFAULT_ROUTING } from '../protocol';
import { DiscoveryRoutes } from './discovery-routes';
import type { PoolConfigStore, PoolDesk } from './model-routes';
import type { RouteContext } from './route-context';

const FOUND: DiscoveredModel = { model: 'zai-coding-plan/glm-5.3-air', provider: 'opencode', slot: 'zai', name: null, capabilities: { tools: true, context: 128_000 }, suggested: 'light' };
const CLASSES = [{ name: 'heavy', sessions: 2 }, { name: 'light', sessions: null }];

class Desk implements PoolDesk {
  current: PoolSettings = { classes: CLASSES, models: [], capacity: { global: null, perSlot: {} }, ledgers: { ticketAllowance: null, personaPerDay: null, providerPerDay: null }, routing: DEFAULT_ROUTING };
  ignoredKeys: string[] = [];
  discovered: boolean[] = [];
  imported = 0;
  settings = (): PoolSettings => this.current;
  errors = (): readonly string[] => [];
  load = () => ({ used: 0, global: null, slots: [], classes: [] });
  queue = () => [];
  providerDay = () => [];
  check = (keys: Readonly<Record<string, unknown>>): readonly string[] => ((keys['models'] as { class: string }[] | undefined) ?? []).filter((row) => !CLASSES.some((c) => c.name === row.class)).map((row) => `class ${row.class} unknown`);
  stored = (settings: PoolSettings): Record<string, unknown> => ({ models: settings.models });
  reload = async (): Promise<void> => undefined;
  importCapabilities = async () => (this.imported++, { ok: true as const, rows: this.current.models, filled: [], unmatched: [] });
  discovery = () => ({ checkedAt: null, running: false, harnesses: [], found: [FOUND], ignored: this.ignoredKeys });
  discover = async (withRegistry: boolean) => (this.discovered.push(withRegistry), { registryError: null });
  offered = (provider: string, model: string): DiscoveredModel | null => (provider === FOUND.provider && model === FOUND.model ? FOUND : null);
  ignored = (): readonly string[] => this.ignoredKeys;
}

class Store implements PoolConfigStore {
  readonly path = '/home/service.json';
  writes: Record<string, unknown>[] = [];
  constructor(private readonly desk: Desk) {}
  writePool = async (keys: Readonly<Record<string, unknown>>) => {
    this.writes.push({ ...keys });
    if (Array.isArray(keys['models'])) {
      this.desk.current = { ...this.desk.current, models: keys['models'] as ModelRow[] };
    }
    const discovery = keys['discovery'] as { ignored?: string[] } | undefined;
    if (discovery?.ignored !== undefined) {
      this.desk.ignoredKeys = discovery.ignored;
    }
    return { ok: true as const };
  };
}

function call(routes: DiscoveryRoutes, pathname: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const ctx = {
      method: 'POST',
      pathname,
      parts: pathname.split('/').filter(Boolean),
      search: new URLSearchParams(),
      body: async () => body,
      respond: (status: number, answer: unknown) => resolve({ status, body: answer as Record<string, unknown> }),
      raw: () => undefined,
      stream: () => ({ write: () => undefined, end: () => undefined, onClose: () => undefined }),
    } as RouteContext;
    void routes.handle(ctx);
  });
}

describe('the discovery routes (req-286)', () => {
  it('Find models again asks the harnesses with the registry; the page’s first look without it', async () => {
    const desk = new Desk();
    const routes = new DiscoveryRoutes(desk, new Store(desk));
    expect((await call(routes, '/models/discover', {})).status).toBe(200);
    expect((await call(routes, '/models/discover', { registry: false })).status).toBe(200);
    expect(desk.discovered).toEqual([true, false]);
    expect(desk.imported).toBe(1);
  });

  it('Add takes a found model into the table under the chosen class, with its account and capabilities', async () => {
    const desk = new Desk();
    const store = new Store(desk);
    const answer = await call(new DiscoveryRoutes(desk, store), '/models/add', { provider: 'opencode', model: FOUND.model, class: 'light' });
    expect(answer.status).toBe(200);
    expect(desk.current.models).toEqual([{ model: FOUND.model, slot: 'zai', provider: 'opencode', category: '', class: 'light', cost: 1, enabled: true, tools: true, context: 128_000 }]);
  });

  it('no model is typed in: one the last check did not find is refused; an unknown class too', async () => {
    const desk = new Desk();
    const routes = new DiscoveryRoutes(desk, new Store(desk));
    expect((await call(routes, '/models/add', { provider: 'kimi', model: 'typed-in', class: 'light' })).status).toBe(404);
    expect((await call(routes, '/models/add', { provider: 'opencode', model: FOUND.model, class: 'gigantic' })).status).toBe(422);
    expect((await call(routes, '/models/add', { provider: 'opencode', model: FOUND.model })).status).toBe(422);
    expect(desk.current.models).toEqual([]);
  });

  it('Ignore keeps the card away (discovery.ignored)', async () => {
    const desk = new Desk();
    const store = new Store(desk);
    expect((await call(new DiscoveryRoutes(desk, store), '/models/ignore', { provider: 'opencode', model: FOUND.model })).status).toBe(200);
    expect(store.writes).toEqual([{ discovery: { ignored: ['opencode:zai-coding-plan/glm-5.3-air'] } }]);
  });
});
