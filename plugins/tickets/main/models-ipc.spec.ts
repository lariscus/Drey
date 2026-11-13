import { describe, expect, it, vi } from 'vitest';
import { registerModelsIpc, type ModelsFleet } from './models-ipc';

/** Settings → Models' IPC (req-170): the pool and the slots over the fleet proxy, payloads checked before they travel. */
describe('registerModelsIpc', () => {
  function wired(): { handlers: Map<string, (payload: unknown) => unknown>; fleet: ModelsFleet } {
    const handlers = new Map<string, (payload: unknown) => unknown>();
    const fleet = {
      models: vi.fn(async () => null),
      writeModels: vi.fn(async () => ({ ok: false as const, error: 'x' })),
      importModelCapabilities: vi.fn(async () => ({ ok: false as const, error: 'v' })),
      discoverModels: vi.fn(async () => ({ ok: false as const, error: 'd' })),
      addDiscoveredModel: vi.fn(async () => ({ ok: false as const, error: 'm' })),
      ignoreDiscoveredModel: vi.fn(async () => ({ ok: false as const, error: 'i' })),
      updateSlot: vi.fn(async () => ({ ok: false as const, error: 'u' })),
      slots: vi.fn(async () => null),
      writeSlots: vi.fn(async () => ({ ok: false as const, error: 'y' })),
      addSlot: vi.fn(async () => ({ ok: false as const, error: 'a' })),
      removeSlot: vi.fn(async () => ({ ok: false as const, error: 'r' })),
      refreshSlots: vi.fn(async () => ({ ok: false as const, error: 'z' })),
      slotLoginDone: vi.fn(async () => ({ ok: false as const, error: 'w' })),
    } satisfies ModelsFleet;
    registerModelsIpc((channel, handler) => handlers.set(channel, handler), fleet);
    return { handlers, fleet };
  }

  it('registers the pool and the slot channels', () => {
    expect([...wired().handlers.keys()]).toEqual(['poolModels', 'poolModelsConfig', 'poolModelsImport', 'poolModelsDiscover', 'poolModelAdd', 'poolModelIgnore', 'slots', 'slotsConfig', 'slotAdd', 'slotRemove', 'slotUpdate', 'slotsRefresh', 'slotLoginDone']);
  });

  it('passes only the pool keys on; a models value that is no list never travels', async () => {
    const { handlers, fleet } = wired();
    await handlers.get('poolModelsConfig')!({ capacity: { global: 6 }, routing: { upgradeAboveQ: 1.5 }, other: 1 });
    expect(fleet.writeModels).toHaveBeenCalledWith({ capacity: { global: 6 }, routing: { upgradeAboveQ: 1.5 } });
    await handlers.get('poolModelsImport')!(undefined);
    expect(fleet.importModelCapabilities).toHaveBeenCalledOnce();
    expect(handlers.get('poolModelsConfig')!({ models: 'opus' })).toEqual({ ok: false, error: 'models is a list of rows' });
    expect(handlers.get('slotsConfig')!({})).toEqual({ ok: false, error: 'the slot config needs a slots list' });
    await handlers.get('slotsRefresh')!({ id: 'claude-a' });
    expect(fleet.refreshSlots).toHaveBeenCalledWith('claude-a');
  });

  it('adds and removes one slot (D-69); a payload without the slot or its id never travels', async () => {
    const { handlers, fleet } = wired();
    await handlers.get('slotAdd')!({ slot: { id: 'claude-b', provider: 'claude-code' } });
    expect(fleet.addSlot).toHaveBeenCalledWith({ id: 'claude-b', provider: 'claude-code' });
    await handlers.get('slotRemove')!({ id: 'kimi' });
    expect(fleet.removeSlot).toHaveBeenCalledWith('kimi');
    await handlers.get('slotRemove')!({ id: 'claude-b', withModels: true });
    expect(fleet.removeSlot).toHaveBeenLastCalledWith({ id: 'claude-b', withModels: true });
    expect(handlers.get('slotAdd')!({})).toEqual({ ok: false, error: 'which slot?' });
    expect(handlers.get('slotRemove')!({ id: 3 })).toEqual({ ok: false, error: 'which slot?' });
  });

  it('req-286/287: every call crosses the engine’s invoke channel as one object payload', async () => {
    const { handlers, fleet } = wired();
    await handlers.get('slotUpdate')!({ id: 'zai', patch: { sessions: 3 } });
    expect(fleet.updateSlot).toHaveBeenCalledWith({ id: 'zai', patch: { sessions: 3 } });
    await handlers.get('poolModelAdd')!({ provider: 'opencode', model: 'm', class: 'light' });
    expect(fleet.addDiscoveredModel).toHaveBeenCalledWith({ provider: 'opencode', model: 'm', class: 'light' });
    await handlers.get('poolModelIgnore')!({ provider: 'opencode', model: 'm' });
    expect(fleet.ignoreDiscoveredModel).toHaveBeenCalledWith({ provider: 'opencode', model: 'm' });
  });
});
