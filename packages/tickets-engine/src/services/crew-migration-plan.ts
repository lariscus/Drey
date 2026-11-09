import { CREW_FIELDS, type CrewKey, type CrewOverrideMap, type CrewPatch, type VaultCrewConfig } from '../contracts/crew-config';
import { crewValueOf } from '../core/crew-file';
import type { CrewOverridePatch } from '../core/crew-file-write';
import { CREW_DEFAULTS } from '../fleet/config/layered-config-resolver';

/** What the old places held: the engine's `config.json` (flat keys) and the old `chain.json`'s `config`. */
export interface LegacyCrewSources {
  readonly config: Readonly<Record<string, unknown>>;
  /** The `config` object of the chain file from before req-173; null when there is none. */
  readonly chain: Readonly<Record<string, unknown>> | null;
}

/** One move the plan makes, for the log: `defaultWorker = claude-code (config.json defaultWorker)`. */
export interface CrewMove {
  readonly key: string;
  readonly value: string;
  readonly from: string;
}

export interface CrewMigration {
  readonly values: readonly CrewPatch[];
  readonly overrides: readonly CrewOverridePatch[];
  readonly moves: readonly CrewMove[];
}

const OVERRIDE_PREFIX: Readonly<Record<CrewOverrideMap, { readonly flat: string; readonly chain: string }>> = {
  compactAboveTokensBy: { flat: 'fleet.compactAboveTokens.', chain: 'compactAboveTokensOverrides' },
  contextCapTokensBy: { flat: 'fleet.contextCapTokens.', chain: 'contextCapTokensOverrides' },
};

const isEntry = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The chain config's value of a key (`caps.diffStatLines` → `config.caps.diffStatLines`). */
function chainValue(chain: Readonly<Record<string, unknown>> | null, key: CrewKey): unknown {
  let node: unknown = chain;
  for (const step of key.split('.')) {
    node = isEntry(node) ? node[step] : undefined;
  }
  return node;
}

/**
 * The one-time move of the vault keys into `_meta/crew.md` (req-173, R13),
 * planned as pure data: every key the file does not hold yet takes the
 * value the engine's `config.json` had (the owner's settings as Drey
 * mirrored them), else the old `chain.json`'s `config`. A key the file
 * already holds is never touched — the vault wins, so a second device's
 * migration adds only what the first did not move. A value equal to the
 * built-in default is not written: it changes nothing and would only
 * clutter the file.
 */
export class CrewMigrationPlan {
  plan(current: VaultCrewConfig, legacy: LegacyCrewSources): CrewMigration {
    const values: CrewPatch[] = [];
    const moves: CrewMove[] = [];
    for (const field of CREW_FIELDS) {
      if (current.values[field.key] !== undefined) {
        continue;
      }
      const found = this.found(field, legacy);
      if (found !== null) {
        values.push({ key: field.key, value: found.value });
        moves.push({ key: field.key, value: found.value === null ? 'off' : String(found.value), from: found.from });
      }
    }
    const overrides = this.overrides(current, legacy, moves);
    return { values, overrides, moves };
  }

  private found(field: (typeof CREW_FIELDS)[number], legacy: LegacyCrewSources): { value: string | number | null; from: string } | null {
    const candidates: [unknown, string][] = [
      [legacy.config[field.legacy], `config.json ${field.legacy}`],
      [chainValue(legacy.chain, field.key), `chain.json config.${field.key}`],
    ];
    for (const [raw, from] of candidates) {
      if (raw === undefined || raw === null || raw === '') {
        continue;
      }
      const value = crewValueOf(field, raw);
      if (value !== undefined) {
        return value === CREW_DEFAULTS[field.key] ? null : { value, from };
      }
    }
    return null;
  }

  private overrides(current: VaultCrewConfig, legacy: LegacyCrewSources, moves: CrewMove[]): CrewOverridePatch[] {
    const out: CrewOverridePatch[] = [];
    for (const map of Object.keys(OVERRIDE_PREFIX) as CrewOverrideMap[]) {
      const prefix = OVERRIDE_PREFIX[map];
      const chainMap = isEntry(legacy.chain?.['handover']) ? (legacy.chain['handover'] as Record<string, unknown>)[prefix.chain] : undefined;
      const entries: [string, unknown, string][] = [
        ...Object.entries(legacy.config).filter(([key]) => key.startsWith(prefix.flat)).map(([key, v]): [string, unknown, string] => [key.slice(prefix.flat.length), v, `config.json ${key}`]),
        ...Object.entries(isEntry(chainMap) ? chainMap : {}).map(([name, v]): [string, unknown, string] => [name, v, `chain.json config.handover.${prefix.chain}.${name}`]),
      ];
      for (const [name, raw, from] of entries) {
        const value = crewValueOf({ kind: 'count' }, raw);
        if (name === '' || typeof value !== 'number' || current.overrides[map][name] !== undefined || out.some((o) => o.map === map && o.name === name)) {
          continue;
        }
        out.push({ map, name, value });
        moves.push({ key: `handover.${map}.${name}`, value: String(value), from });
      }
    }
    return out;
  }
}
