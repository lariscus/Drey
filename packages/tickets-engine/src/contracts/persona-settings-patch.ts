import { parseNeeds } from '../core/config/model-needs';
import {
  PERSONA_GATES,
  PERSONA_LEAVING_ACTIONS,
  type PersonaGate,
  type PersonaLeavingAction,
  type PersonaSettings,
} from '../core/persona/persona-settings';

/**
 * The run settings a persona patch may send (req-258, the page's Work block
 * and the API): only the sent keys change. `null` clears a key — the
 * column's value or the role's default applies again; `needs` is the
 * req-178 grammar as one line (`image, context-200k`), '' clears it.
 */
export interface PersonaSettingsPatch {
  readonly needs?: string;
  readonly maxTurns?: number | null;
  readonly maxWorkMin?: number | null;
  readonly gate?: PersonaGate | null;
  readonly parallel?: number | null;
  readonly min?: number;
  readonly leaving?: readonly PersonaLeavingAction[];
  readonly readOnly?: boolean | null;
}

/** The record's settings after a patch: sent keys replace, the others stay. */
export function settingsAfter(current: PersonaSettings, patch: PersonaSettingsPatch): PersonaSettings {
  const pick = <K extends keyof PersonaSettings>(key: K, sent: PersonaSettings[K] | undefined): PersonaSettings[K] => (sent === undefined ? current[key] : sent);
  return {
    needs: patch.needs === undefined ? current.needs : parseNeeds(patch.needs).needs,
    maxTurns: pick('maxTurns', patch.maxTurns),
    maxWorkMin: pick('maxWorkMin', patch.maxWorkMin),
    gate: pick('gate', patch.gate),
    parallel: pick('parallel', patch.parallel),
    min: pick('min', patch.min),
    leaving: patch.leaving === undefined ? current.leaving : [...new Set(patch.leaving)],
    readOnly: pick('readOnly', patch.readOnly),
  };
}

type Check = readonly [keyof PersonaSettingsPatch, (value: unknown) => boolean];

const positiveOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
const inList = (list: readonly string[]) => (value: unknown): boolean => value === null || (typeof value === 'string' && list.includes(value));

const CHECKS: readonly Check[] = [
  ['needs', (value) => typeof value === 'string' && parseNeeds(value).unknown.length === 0],
  ['maxTurns', positiveOrNull],
  ['maxWorkMin', positiveOrNull],
  ['gate', inList(PERSONA_GATES)],
  ['parallel', positiveOrNull],
  ['min', (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0],
  ['leaving', (value) => Array.isArray(value) && value.every((item) => (PERSONA_LEAVING_ACTIONS as readonly unknown[]).includes(item))],
  ['readOnly', (value) => value === null || typeof value === 'boolean'],
];

/** The first broken key's reason; null = writable. */
export function settingsPatchError(patch: unknown): string | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return 'settings is an object';
  }
  const record = patch as Record<string, unknown>;
  const broken = CHECKS.find(([key, ok]) => record[key] !== undefined && !ok(record[key]));
  return broken === undefined ? null : `settings.${broken[0]} has a value of the wrong kind`;
}
