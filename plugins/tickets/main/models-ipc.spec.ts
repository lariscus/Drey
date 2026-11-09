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
      slots: vi.fn(async () => null),
      writeSlots: vi.fn(async () => ({ ok: false as const, error: 'y' })),
      refreshSlots: vi.fn(async () => ({ ok: false as const, error: 'z' })),
      slotLoginDone: vi.fn(async () => ({ ok: false as const, error: 'w' })),
    } satisfies ModelsFleet;
    registerModelsIpc((channel, handler) => handlers.set(channel, handler), fleet);
    return { handlers, fleet };
  }

  it('registers the pool and the slot channels', () => {
    expect([...wired().handlers.keys()]).toEqual(['poolModels', 'poolModelsConfig', 'poolModelsImport', 'slots', 'slotsConfig', 'slotsRefresh', 'slotLoginDone']);
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
});
