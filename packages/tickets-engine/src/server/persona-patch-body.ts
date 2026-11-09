import type { PersonaAllowedPatch } from '../contracts/persona-allowed';
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
];

export function parsePersonaPatch(body: unknown): Parsed<PersonaPatchInput> {
  const obj = asObject(body);
  if (obj === null) {
    return { ok: false, error: 'bad persona patch payload' };
  }
  const out: PersonaPatchInput = {};
  let any = false;
  for (const key of PERSONA_PATCH_KEYS) {
    const value = obj[key];
    if (value === undefined) {
      continue;
    }
    if (key === 'pool' || key === 'skills') {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        return { ok: false, error: `${key} is a list of names` };
      }
      out[key] = value.map((v) => (v as string).trim());
    } else if (key === 'budget') {
      if (value !== null && typeof value !== 'number') {
        return { ok: false, error: 'budget is a number of dollars or null' };
      }
      out.budget = value;
    } else if (key === 'allowed') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { ok: false, error: 'allowed is an object' };
      }
      out.allowed = value as PersonaAllowedPatch;
    } else if (typeof value !== 'string') {
      return { ok: false, error: `${key} is a string` };
    } else {
      out[key] = value;
    }
    any = true;
  }
  if (!any) {
    return { ok: false, error: `the patch carries none of the writable keys: ${PERSONA_PATCH_KEYS.join(', ')}` };
  }
  return { ok: true, value: out };
}
