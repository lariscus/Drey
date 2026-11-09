/**
 * The Settings → Models page's IPC (req-170, board 7l; the slots of req-177
 * beside it): the renderer reads and writes the capacity pool and the slots
 * over the engine's fleet proxy, which asks the runner's `/models` and
 * `/slots` routes. A read while no runner is awake answers null (it never
 * wakes one); a write wakes it.
 */
import type { ModelsReply } from '../../../packages/tickets-engine/src/fleet/protocol';
import type { FleetClient, SlotsReply } from '../../../packages/tickets-engine/src/services/fleet-client';

/** What the handlers need of the fleet proxy. */
export type ModelsFleet = Pick<FleetClient, 'models' | 'writeModels' | 'slots' | 'writeSlots' | 'refreshSlots' | 'slotLoginDone'>;

type Handle = (channel: string, handler: (payload: unknown) => unknown) => void;
type Refusal = { readonly ok: false; readonly error: string };

const objectOf = (payload: unknown): Record<string, unknown> => (payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {});

/** The pool write's payload: only the three keys travel. */
export function poolKeysOfPayload(payload: unknown): { models?: readonly unknown[]; capacity?: unknown; ledgers?: unknown } | Refusal {
  const body = objectOf(payload);
  if (body['models'] !== undefined && !Array.isArray(body['models'])) {
    return { ok: false, error: 'models is a list of rows' };
  }
  return {
    ...(body['models'] !== undefined ? { models: body['models'] as readonly unknown[] } : {}),
    ...(body['capacity'] !== undefined ? { capacity: body['capacity'] } : {}),
    ...(body['ledgers'] !== undefined ? { ledgers: body['ledgers'] } : {}),
  };
}

export function registerModelsIpc(handle: Handle, fleet: ModelsFleet): void {
  handle('poolModels', (): Promise<ModelsReply | null> => fleet.models());
  handle('poolModelsConfig', (payload): Promise<ModelsReply | Refusal> | Refusal => {
    const keys = poolKeysOfPayload(payload);
    return 'ok' in keys ? keys : fleet.writeModels(keys);
  });
  handle('slots', (): Promise<SlotsReply | null> => fleet.slots());
  handle('slotsConfig', (payload): Promise<SlotsReply | Refusal> | Refusal => {
    const slots = objectOf(payload)['slots'];
    return Array.isArray(slots) ? fleet.writeSlots(slots) : { ok: false, error: 'the slot config needs a slots list' };
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
