/**
 * The vault layer of the configuration (req-173, R13, ADR-0092 later
 * change): `tickets/_meta/crew.md`, versioned with the tickets repository,
 * so a second device reading the same `_meta/` sees the same crew. Its
 * frontmatter holds the crew's defaults and limits — the default persona,
 * the default worker, the permission mode of dispatched runs and the caps
 * (instruction output caps, handover thresholds).
 * Every key is optional; an absent key is the built-in default. A key of a
 * retired feature (e.g. a leftover `tranche:` block) is ignored.
 *
 * The machine layer (`service.json`) and the session layer (the session
 * record) are elsewhere; `fleet/config/layered-config-resolver.ts` is the
 * one place the three meet. Pure types and the key table, shared by the
 * engine, the tickets plugin and its Settings page.
 */

/** The vault-relative path of the file. */
export const CREW_FILE = 'tickets/_meta/crew.md';

/** How a key's value is read and written. */
export type CrewValueKind =
  /** A non-empty text (`default-persona`, `default-worker`). */
  | 'text'
  /** `accept-edits` or `bypass` — the dispatched runs' mode (read-only is a session's, never a crew default). */
  | 'permission'
  /** A non-negative number (the caps, the handover thresholds). */
  | 'count';

/** One key of the file: its camelCase id (the API's), its YAML path, its kind. */
export interface CrewField {
  readonly key: CrewKey;
  readonly path: readonly string[];
  readonly kind: CrewValueKind;
  /** The legacy flat key it moved from (`~/.drey-engine/config.json`, req-173's migration). */
  readonly legacy: string;
}

export const CREW_KEYS = [
  'defaultPersona',
  'defaultWorker',
  'permissionMode',
  'caps.gateFailureLines',
  'caps.gateFailureBytes',
  'caps.diffStatLines',
  'caps.diffStatBytes',
  'handover.compactAboveTokens',
  'handover.resumePauseTtlMin',
  'handover.contextCapTokens',
] as const;

export type CrewKey = (typeof CREW_KEYS)[number];

const kebab = (word: string): string => word.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function kindOf(key: CrewKey): CrewValueKind {
  if (key === 'permissionMode') {
    return 'permission';
  }
  if (key === 'defaultPersona' || key === 'defaultWorker') {
    return 'text';
  }
  return 'count';
}

function legacyOf(key: CrewKey): string {
  const leaf = key.split('.').pop() ?? key;
  if (key === 'defaultPersona') {
    return 'personas.default';
  }
  if (key === 'permissionMode') {
    return 'autoPermissionMode';
  }
  if (key.startsWith('caps.')) {
    return `fleet.cap.${leaf}`;
  }
  return key.startsWith('handover.') ? `fleet.${leaf}` : key;
}

/** Every key with its YAML path (`caps.gateFailureLines` → `caps / gate-failure-lines`) and its legacy key. */
export const CREW_FIELDS: readonly CrewField[] = CREW_KEYS.map((key) => ({ key, path: key.split('.').map(kebab), kind: kindOf(key), legacy: legacyOf(key) }));

/** The per-provider/model handover overrides (`compact-above-tokens-by:` / `context-cap-tokens-by:` under `handover:`). */
export const CREW_OVERRIDE_MAPS = ['compactAboveTokensBy', 'contextCapTokensBy'] as const;

export type CrewOverrideMap = (typeof CREW_OVERRIDE_MAPS)[number];

/** A key's value: text, a number, or null for `off` (a limit switched off). */
export type CrewValue = string | number | null;

/** What the file sets: only the keys it holds. */
export interface VaultCrewConfig {
  readonly values: Readonly<Partial<Record<CrewKey, CrewValue>>>;
  readonly overrides: Readonly<Record<CrewOverrideMap, Readonly<Record<string, number>>>>;
}

export const EMPTY_CREW_CONFIG: VaultCrewConfig = { values: {}, overrides: { compactAboveTokensBy: {}, contextCapTokensBy: {} } };

/** One per-provider/model override set (a number of tokens) or removed (`undefined`). */
export interface CrewOverridePatch {
  readonly map: CrewOverrideMap;
  readonly name: string;
  readonly value: number | undefined;
}

/** One change of the file: a value, or `undefined` to remove the key (the default applies again). */
export interface CrewPatch {
  readonly key: CrewKey;
  readonly value: CrewValue | undefined;
}

/** Where a resolved value came from (the Settings page names the layer, R13). */
export type CrewSource = 'vault' | 'default';

/** `crewConfig`'s reply: the file's values, the resolved ones, and where each came from. */
export type CrewConfigReply =
  | {
      readonly ok: true;
      /** Vault-relative path of the file (it may not exist yet). */
      readonly file: string;
      readonly values: Readonly<Partial<Record<CrewKey, CrewValue>>>;
      readonly resolved: Readonly<Record<CrewKey, CrewValue>>;
      readonly sources: Readonly<Record<CrewKey, CrewSource>>;
      /** The per-provider/model handover overrides the file holds. */
      readonly overrides: VaultCrewConfig['overrides'];
      /** The file does not parse: the owner's text stays, nothing is written over it. */
      readonly error: string | null;
    }
  | { readonly ok: false; readonly error: string };

export function crewFieldOf(key: string): CrewField | null {
  return CREW_FIELDS.find((field) => field.key === key) ?? null;
}
