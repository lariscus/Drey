/**
 * The invoke payloads of req-173 checked at the engine's door: the crew
 * patches Settings → Tickets sends (`crewConfigSet`) and the free session
 * asks of the service window, the Crew tab and Pia's card (`sessionStart`).
 * A wrong shape never reaches a service.
 */
import { CREW_OVERRIDE_MAPS, crewFieldOf, type CrewOverrideMap, type CrewOverridePatch, type CrewPatch } from '../contracts/crew-config';
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

/** `{ overrides: [{ map, name, value? }] }`: the per-provider/model handover thresholds; without `value` the entry goes. */
export function parseCrewOverrides(payload: unknown): readonly CrewOverridePatch[] {
  const list = isRecord(payload) && Array.isArray(payload['overrides']) ? (payload['overrides'] as unknown[]) : [];
  return list.map(overrideOf).filter((patch): patch is CrewOverridePatch => patch !== null);
}

/** One override entry, or null when its map, name or value is wrong. */
function overrideOf(entry: unknown): CrewOverridePatch | null {
  if (!isRecord(entry) || !(CREW_OVERRIDE_MAPS as readonly unknown[]).includes(entry['map'])) {
    return null;
  }
  const name = text(entry['name']);
  const value = entry['value'];
  const valid = value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return name === null || !valid ? null : { map: entry['map'] as CrewOverrideMap, name, value: typeof value === 'number' ? value : undefined };
}

const CLASSES = ['A', 'B', 'C'] as const;

/** The optional fields of an ask, each checked; the error of the first wrong one. */
function optionalsOf(payload: Record<string, unknown>): Omit<FreeSessionAsk, 'persona' | 'directory'> | string {
  const poolClass = payload['poolClass'];
  if (poolClass !== undefined && poolClass !== null && !(CLASSES as readonly unknown[]).includes(poolClass)) {
    return `unknown class "${String(poolClass)}"`;
  }
  const permission = payload['permissionMode'];
  if (permission !== undefined && !(SESSION_PERMISSIONS as readonly unknown[]).includes(permission)) {
    return `unknown permission mode "${String(permission)}"`;
  }
  const model = text(payload['model']);
  const firstLine = text(payload['firstLine']);
  return {
    ...(poolClass !== undefined && poolClass !== null ? { poolClass: poolClass as (typeof CLASSES)[number] } : {}),
    ...(permission !== undefined ? { permissionMode: permission as SessionPermission } : {}),
    ...(model !== null ? { model } : {}),
    ...(firstLine !== null ? { firstLine } : {}),
  };
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
  const optionals = optionalsOf(payload);
  if (typeof optionals === 'string') {
    return { ok: false, error: optionals };
  }
  return { ok: true, value: { persona, directory, ...optionals }, origin: text(payload['origin']) ?? 'drey' };
}
