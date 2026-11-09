/**
 * The invoke payloads of req-173 checked at the engine's door: the crew
 * patches Settings → Tickets sends (`crewConfigSet`) and the free session
 * asks of the service window, the Crew tab and Pia's card (`sessionStart`).
 * A wrong shape never reaches a service.
 */
import { crewFieldOf, type CrewPatch } from '../contracts/crew-config';
import { SESSION_PERMISSIONS, type FreeSessionAsk, type SessionPermission } from '../contracts/free-session';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `[{ key, value }]` or `{ patches: [...] }`; a patch without `value` removes the key. Unknown keys and bad values are dropped. */
export function parseCrewPatches(payload: unknown): readonly CrewPatch[] {
  const list = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload['patches']) ? payload['patches'] : [];
  const out: CrewPatch[] = [];
  for (const entry of list as unknown[]) {
    if (!isRecord(entry) || typeof entry['key'] !== 'string' || crewFieldOf(entry['key']) === null) {
      continue;
    }
    const value = entry['value'];
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number') {
      out.push({ key: crewFieldOf(entry['key'])!.key, value });
    }
  }
  return out;
}

export type ParsedAsk = { readonly ok: true; readonly value: FreeSessionAsk; readonly origin: string } | { readonly ok: false; readonly error: string };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** `{ persona, directory, poolClass?, permissionMode?, model?, firstLine?, origin? }`. */
export function parseFreeSessionAsk(payload: unknown): ParsedAsk {
  if (!isRecord(payload)) {
    return { ok: false, error: 'a session start needs { persona, directory }' };
  }
  const persona = text(payload['persona']);
  const directory = text(payload['directory']);
  if (persona === null || directory === null) {
    return { ok: false, error: 'a session start names its persona and its directory' };
  }
  const poolClass = payload['poolClass'];
  if (poolClass !== undefined && poolClass !== null && poolClass !== 'A' && poolClass !== 'B' && poolClass !== 'C') {
    return { ok: false, error: `unknown class "${String(poolClass)}"` };
  }
  const permission = payload['permissionMode'];
  if (permission !== undefined && !(SESSION_PERMISSIONS as readonly unknown[]).includes(permission)) {
    return { ok: false, error: `unknown permission mode "${String(permission)}"` };
  }
  const model = payload['model'];
  const firstLine = text(payload['firstLine']);
  const value: FreeSessionAsk = {
    persona,
    directory,
    ...(poolClass === 'A' || poolClass === 'B' || poolClass === 'C' ? { poolClass } : {}),
    ...(permission !== undefined ? { permissionMode: permission as SessionPermission } : {}),
    ...(typeof model === 'string' && model.trim() !== '' ? { model: model.trim() } : {}),
    ...(firstLine !== null ? { firstLine } : {}),
  };
  return { ok: true, value, origin: text(payload['origin']) ?? 'drey' };
}
