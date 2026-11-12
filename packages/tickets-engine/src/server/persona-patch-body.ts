import type { PersonaAllowedPatch } from '../contracts/persona-allowed';
import type { PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import type { Parsed } from '../core/commands';

/**
 * The persona setup's PATCH body (U4, concept §4.5): only the listed keys
 * are writable, each checked for its shape. The router policies of §4.6
 * were removed with req-170 — a persona's pool is ordered strongest first
 * and the capacity pool picks by class.
 */
function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export interface PersonaPatchInput {
  title?: string;
  role?: string;
  worker?: string;
  model?: string;
  pool?: string[];
  color?: string;
  skills?: string[];
  prompt?: string;
  summary?: string;
  budget?: number | null;
  allowed?: PersonaAllowedPatch;
  settings?: PersonaSettingsPatch;
}

const PERSONA_PATCH_KEYS: readonly (keyof PersonaPatchInput)[] = [
  'title',
  'role',
  'worker',
  'model',
  'pool',
  'color',
  'skills',
  'prompt',
  'summary',
  'budget',
  'allowed',
  'settings',
];

/** One key's value as the patch carries it: the shape checked, or the refusal. */
function valueOf(key: keyof PersonaPatchInput, value: unknown): Parsed<unknown> {
  switch (key) {
    case 'pool':
    case 'skills':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? { ok: true, value: value.map((v) => (v as string).trim()) }
        : { ok: false, error: `${key} is a list of names` };
    case 'budget':
      return value === null || typeof value === 'number' ? { ok: true, value } : { ok: false, error: 'budget is a number of dollars or null' };
    case 'allowed':
    case 'settings':
      return asObject(value) !== null ? { ok: true, value } : { ok: false, error: `${key} is an object` };
    default:
      return typeof value === 'string' ? { ok: true, value } : { ok: false, error: `${key} is a string` };
  }
}

export function parsePersonaPatch(body: unknown): Parsed<PersonaPatchInput> {
  const obj = asObject(body);
  if (obj === null) {
    return { ok: false, error: 'bad persona patch payload' };
  }
  const out: Record<string, unknown> = {};
  let any = false;
  for (const key of PERSONA_PATCH_KEYS) {
    if (obj[key] === undefined) {
      continue;
    }
    const parsed = valueOf(key, obj[key]);
    if (!parsed.ok) {
      return parsed;
    }
    out[key] = parsed.value;
    any = true;
  }
  if (!any) {
    return { ok: false, error: `the patch carries none of the writable keys: ${PERSONA_PATCH_KEYS.join(', ')}` };
  }
  return { ok: true, value: out as PersonaPatchInput };
}
