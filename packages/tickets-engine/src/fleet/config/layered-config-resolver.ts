import {
  CREW_FIELDS,
  CREW_KEYS,
  EMPTY_CREW_CONFIG,
  type CrewKey,
  type CrewSource,
  type CrewValue,
  type VaultCrewConfig,
} from '../../contracts/crew-config';
import { DEFAULT_FLEET_CAPS, DEFAULT_FLEET_HANDOVER, normalizeFleetCaps, normalizeFleetHandover, type FleetCaps, type FleetHandoverConfig } from '../protocol-fleet-config';
import type { CapabilityClass } from '../protocol-pool';
import type { PermissionMode } from '../protocol';

/** The fleet floor when neither the vault nor anything else names a worker. */
export const BUILT_IN_WORKER = 'opencode';

/** The crew's values as the board and the chain use them: every key resolved, and from which layer. */
export interface EffectiveCrew {
  readonly defaultPersona: string | null;
  readonly defaultWorker: string;
  readonly permissionMode: PermissionMode;
  readonly caps: FleetCaps;
  readonly handover: FleetHandoverConfig;
  readonly values: Readonly<Record<CrewKey, CrewValue>>;
  readonly sources: Readonly<Record<CrewKey, CrewSource>>;
}

/** What a session record may set over the vault (R13's session layer). */
export interface SessionOverrides {
  /** The record's permission override; absent = the vault's mode. */
  readonly permissionMode?: PermissionMode;
  /** A model pin on the record (`model` of the harness); absent = the persona's. */
  readonly model?: string | null;
  /** The class the session asks the pool for; absent = the model table's class of its model. */
  readonly poolClass?: CapabilityClass;
}

/** One session's resolved values. */
export interface EffectiveSession {
  readonly permissionMode: PermissionMode;
  readonly model: string | null;
  readonly poolClass: CapabilityClass | null;
}

/** The built-in default of every key — the bottom of the precedence. */
function builtIn(): Readonly<Record<CrewKey, CrewValue>> {
  const caps: Record<string, CrewValue> = { ...DEFAULT_FLEET_CAPS };
  const handover: Record<string, CrewValue> = { compactAboveTokens: DEFAULT_FLEET_HANDOVER.compactAboveTokens, resumePauseTtlMin: DEFAULT_FLEET_HANDOVER.resumePauseTtlMin, contextCapTokens: DEFAULT_FLEET_HANDOVER.contextCapTokens };
  const out = {} as Record<CrewKey, CrewValue>;
  for (const key of CREW_KEYS) {
    const leaf = key.split('.').pop() ?? key;
    out[key] = key.startsWith('caps.')
      ? caps[leaf]!
      : key.startsWith('handover.')
        ? handover[leaf]!
        : key === 'defaultWorker'
          ? BUILT_IN_WORKER
          : key === 'permissionMode'
            ? 'accept-edits'
            : null;
  }
  return out;
}

export const CREW_DEFAULTS: Readonly<Record<CrewKey, CrewValue>> = builtIn();

/** The values under one prefix as an object (`caps.` → `{ gateFailureLines: 40, … }`). */
function group(values: Readonly<Record<CrewKey, CrewValue>>, prefix: string): Record<string, CrewValue> {
  return Object.fromEntries(CREW_FIELDS.filter((f) => f.key.startsWith(prefix) && !f.key.slice(prefix.length).includes('.')).map((f) => [f.key.slice(prefix.length), values[f.key]]));
}

/**
 * The three configuration layers of R13 resolved in one place (req-173,
 * ADR-0092 later change). The precedence, written down once:
 *
 *   session record  >  vault (`_meta/crew.md`)  >  built-in default
 *
 * and the machine layer (`service.json`: the model table, the capacity
 * cap, the slots, providers and keys, paths, autostart) stands beside it:
 * a machine key is set only there and read only from there — no vault or
 * session key overrides it, and a session's class request is still served
 * only within the machine's cap (the pool decides, ADR-0095). A vault key
 * never reads a device's settings: what is not in `_meta/crew.md` is the
 * built-in default on every device, so two devices on the same `_meta/`
 * resolve the same crew.
 */
export class LayeredConfigResolver {
  /** The crew: the vault's values over the built-in defaults. */
  crew(vault: VaultCrewConfig | null): EffectiveCrew {
    const file = vault ?? EMPTY_CREW_CONFIG;
    const values = {} as Record<CrewKey, CrewValue>;
    const sources = {} as Record<CrewKey, CrewSource>;
    for (const key of CREW_KEYS) {
      const own = file.values[key];
      values[key] = own !== undefined ? own : CREW_DEFAULTS[key];
      sources[key] = own !== undefined ? 'vault' : 'default';
    }
    return {
      // req-257 (owner 2026-11-11): the crew's default persona is retired — read with a warning (crew-file.ts), never used.
      defaultPersona: null,
      defaultWorker: typeof values.defaultWorker === 'string' ? values.defaultWorker : BUILT_IN_WORKER,
      permissionMode: values.permissionMode === 'bypass' ? 'bypass' : 'accept-edits',
      caps: normalizeFleetCaps(group(values, 'caps.')),
      handover: this.handoverOf(values, file),
      values,
      sources,
    };
  }

  /** A session's values: its record's overrides over the vault's (the persona's model in between). */
  session(crew: Pick<EffectiveCrew, 'permissionMode'>, personaModel: string | null, overrides: SessionOverrides): EffectiveSession {
    return {
      permissionMode: overrides.permissionMode ?? crew.permissionMode,
      model: overrides.model !== undefined ? overrides.model : personaModel,
      poolClass: overrides.poolClass ?? null,
    };
  }

  private handoverOf(values: Readonly<Record<CrewKey, CrewValue>>, file: VaultCrewConfig): FleetHandoverConfig {
    return normalizeFleetHandover({
      ...group(values, 'handover.'),
      compactAboveTokensOverrides: file.overrides.compactAboveTokensBy,
      contextCapTokensOverrides: file.overrides.contextCapTokensBy,
    });
  }
}
