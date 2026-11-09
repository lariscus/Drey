/**
 * `tickets/_meta/crew.md` read (req-173, R13): the vault layer of the
 * configuration — see `contracts/crew-config.ts` for the keys and
 * `specs/ticket-schema.md` for the format. A key with a value of the wrong
 * shape is dropped with a warning (the default applies), a file whose YAML
 * does not parse reads as empty with the error — never a guess.
 */
import { parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import {
  CREW_FIELDS,
  CREW_OVERRIDE_MAPS,
  EMPTY_CREW_CONFIG,
  type CrewField,
  type CrewOverrideMap,
  type CrewValue,
  type CrewKey,
  type VaultCrewConfig,
} from '../contracts/crew-config';

export interface CrewParse {
  readonly config: VaultCrewConfig;
  readonly error: string | null;
  readonly warnings: readonly string[];
}

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A raw value checked against its kind; `undefined` = not readable. A
 * limit reads `off`, `false` and `0` as switched off (null), like the
 * tranche's config always did.
 */
export function crewValueOf(field: Pick<CrewField, 'kind'>, raw: unknown): CrewValue | undefined {
  switch (field.kind) {
    case 'text':
      return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
    case 'permission':
      return raw === 'accept-edits' || raw === 'bypass' ? raw : undefined;
    case 'count':
      return numberOf(raw, 0);
    case 'limit':
      return limitOf(raw);
  }
}

/** A limit: `off` / `false` / `0` is switched off (null), else a positive number. */
function limitOf(raw: unknown): CrewValue | undefined {
  return raw === false || raw === 'off' || raw === 0 || raw === '0' ? null : numberOf(raw, Number.MIN_VALUE);
}

function numberOf(raw: unknown, min: number): number | undefined {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= min ? n : undefined;
}

function at(root: Entry, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (!isEntry(node)) {
      return undefined;
    }
    node = node[step];
  }
  return node;
}

/** The YAML key of an override map under `handover:`. */
export function overridePath(map: CrewOverrideMap): readonly string[] {
  return ['handover', map === 'compactAboveTokensBy' ? 'compact-above-tokens-by' : 'context-cap-tokens-by'];
}

function overridesOf(root: Entry, map: CrewOverrideMap, warnings: string[]): Record<string, number> {
  const raw = at(root, overridePath(map));
  const out: Record<string, number> = {};
  if (raw === undefined || raw === null) {
    return out;
  }
  if (!isEntry(raw)) {
    warnings.push(`crew.md: handover.${overridePath(map)[1]} must be a mapping of worker → tokens`);
    return out;
  }
  for (const [name, value] of Object.entries(raw)) {
    const n = numberOf(value, 0);
    if (n === undefined) {
      warnings.push(`crew.md: handover.${overridePath(map)[1]}.${name} must be a number of tokens`);
    } else {
      out[name] = n;
    }
  }
  return out;
}

/** The frontmatter's root mapping, or the error the file fails on; an absent fence is an empty file. */
export function crewRoot(text: string): Entry | string {
  const { yamlText, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    return {};
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return `crew.md does not parse: ${doc.errors[0]!.message}`;
  }
  const parsed = doc.toJS() as unknown;
  return isEntry(parsed) ? parsed : {};
}

/** Reads the file; null (absent) is the empty configuration. */
export function parseCrewFile(text: string | null): CrewParse {
  if (text === null) {
    return { config: EMPTY_CREW_CONFIG, error: null, warnings: [] };
  }
  const root = crewRoot(text);
  if (typeof root === 'string') {
    return { config: EMPTY_CREW_CONFIG, error: root, warnings: [] };
  }
  const warnings: string[] = [];
  const values: Partial<Record<CrewKey, CrewValue>> = {};
  for (const field of CREW_FIELDS) {
    const raw = at(root, field.path);
    if (raw === undefined || raw === null) {
      continue;
    }
    const value = crewValueOf(field, raw);
    if (value === undefined) {
      warnings.push(`crew.md: ${field.path.join('.')} has a value of the wrong kind (${field.kind}) — the default applies`);
    } else {
      values[field.key] = value;
    }
  }
  const [compact, cap] = CREW_OVERRIDE_MAPS.map((map) => overridesOf(root, map, warnings));
  return { config: { values, overrides: { compactAboveTokensBy: compact!, contextCapTokensBy: cap! } }, error: null, warnings };
}
