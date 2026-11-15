/**
 * The Settings → Models page's IPC (req-170, board 7l; the slots of req-177
 * beside it; req-178's routing keys and the models.dev import): the renderer reads and writes the capacity pool and the slots
 * over the engine's fleet proxy, which asks the runner's `/models` and
 * `/slots` routes (D-69 added one slot's add and remove). A read while no runner is awake answers null (it never
 * wakes one); a write wakes it.
 */
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { FleetClient, SlotsReply } from '../../../../packages/tickets-engine/src/services/fleet-client';

/** What the handlers need of the fleet proxy. */
export type ModelsFleet = Pick<
  FleetClient,
  'models' | 'writeModels' | 'importModelCapabilities' | 'discoverModels' | 'addDiscoveredModel' | 'ignoreDiscoveredModel' | 'slots' | 'writeSlots' | 'addSlot' | 'removeSlot' | 'updateSlot' | 'refreshSlots' | 'slotLoginDone'
>;

type Handle = (channel: string, handler: (payload: unknown) => unknown) => void;
type Refusal = { readonly ok: false; readonly error: string };

const objectOf = (payload: unknown): Record<string, unknown> => (payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {});

/** The pool write's payload: only the five keys travel (req-178 added `routing`, req-287 `classes`). */
export function poolKeysOfPayload(payload: unknown): { classes?: readonly unknown[]; models?: readonly unknown[]; capacity?: unknown; ledgers?: unknown; routing?: unknown } | Refusal {
  const body = objectOf(payload);
  if (body['models'] !== undefined && !Array.isArray(body['models'])) {
    return { ok: false, error: 'models is a list of rows' };
  }
  if (body['classes'] !== undefined && !Array.isArray(body['classes'])) {
    return { ok: false, error: 'classes is a list' };
  }
  return {
    ...(body['classes'] !== undefined ? { classes: body['classes'] as readonly unknown[] } : {}),
    ...(body['models'] !== undefined ? { models: body['models'] as readonly unknown[] } : {}),
    ...(body['capacity'] !== undefined ? { capacity: body['capacity'] } : {}),
    ...(body['ledgers'] !== undefined ? { ledgers: body['ledgers'] } : {}),
    ...(body['routing'] !== undefined ? { routing: body['routing'] } : {}),
  };
}

export function registerModelsIpc(handle: Handle, fleet: ModelsFleet): void {
  handle('poolModels', (): Promise<ModelsReply | null> => fleet.models());
  handle('poolModelsConfig', (payload): Promise<ModelsReply | Refusal> | Refusal => {
    const keys = poolKeysOfPayload(payload);
    return 'ok' in keys ? keys : fleet.writeModels(keys);
  });
  handle('poolModelsImport', (): Promise<ModelsReply | Refusal> => fleet.importModelCapabilities());
  // req-286: Find models again, and a new-model card's Add / Ignore.
  handle('poolModelsDiscover', (payload) => fleet.discoverModels(objectOf(payload)['registry'] !== false));
  handle('poolModelAdd', (payload): Promise<ModelsReply | Refusal> | Refusal => {
    const { provider, model, class: cls } = objectOf(payload);
    return typeof provider === 'string' && typeof model === 'string' && typeof cls === 'string' ? fleet.addDiscoveredModel({ provider, model, class: cls }) : { ok: false, error: 'which model, which class?' };
  });
  handle('poolModelIgnore', (payload): Promise<ModelsReply | Refusal> | Refusal => {
    const { provider, model } = objectOf(payload);
    return typeof provider === 'string' && typeof model === 'string' ? fleet.ignoreDiscoveredModel({ provider, model }) : { ok: false, error: 'which model?' };
  });
  handle('slots', (): Promise<SlotsReply | null> => fleet.slots());
  handle('slotsConfig', (payload): Promise<SlotsReply | Refusal> | Refusal => {
    const slots = objectOf(payload)['slots'];
    return Array.isArray(slots) ? fleet.writeSlots(slots) : { ok: false, error: 'the slot config needs a slots list' };
  });
  handle('slotAdd', (payload): Promise<SlotsReply | Refusal> | Refusal => {
    const slot = objectOf(payload)['slot'];
    return slot !== null && typeof slot === 'object' && !Array.isArray(slot) ? fleet.addSlot(slot) : { ok: false, error: 'which slot?' };
  });
  handle('slotRemove', (payload): Promise<SlotsReply | Refusal> | Refusal => {
    const { id, withModels } = objectOf(payload);
    return typeof id === 'string' ? fleet.removeSlot(withModels === true ? { id, withModels: true } : id) : { ok: false, error: 'which slot?' };
  });
  // req-287: an account's label, cost or sessions edited in place.
  handle('slotUpdate', (payload): Promise<SlotsReply | Refusal> | Refusal => {
    const { id, patch } = objectOf(payload);
    return typeof id === 'string' && patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? fleet.updateSlot({ id, patch: patch as Record<string, unknown> }) : { ok: false, error: 'which slot?' };
  });
  handle('slotsRefresh', (payload) => {
    const id = objectOf(payload)['id'];
    return fleet.refreshSlots(typeof id === 'string' ? id : undefined);
  });
  handle('slotLoginDone', (payload) => {
    const id = objectOf(payload)['id'];
    return typeof id === 'string' ? fleet.slotLoginDone(id) : { ok: false, error: 'which slot?' };
  });
}
