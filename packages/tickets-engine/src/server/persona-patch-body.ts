import type { PersonaAllowedPatch } from '../contracts/persona-allowed';
import type { PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import type { Parsed } from '../core/ticket/commands';

/**
 * The persona setup's PATCH body (U4, concept §4.5): only the listed keys
 * are writable, each checked for its shape. Persona v3 (req-288): `class`
 * names the persona's capability class, `model` its pinned model (null =
 * the next free model of the class); `worker` and `pool` left with it.
 */
function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export interface PersonaPatchInput {
  title?: string;
  role?: string;
  /** req-288: the capability class. */
  class?: string;
  /** req-288: the pinned model (`<provider>/<model>`); null = the next free model of the class. */
  model?: string | null;
  color?: string;
  skills?: string[];
  prompt?: string;
  summary?: string;
  budget?: number | null;
  allowed?: PersonaAllowedPatch;
  settings?: PersonaSettingsPatch;
  /** req-293: Mission Control's persona's chat model; null = the assistant's. */
  chatModel?: string | null;
}

const PERSONA_PATCH_KEYS: readonly (keyof PersonaPatchInput)[] = [
  'title',
  'role',
  'class',
  'model',
  'color',
  'skills',
  'prompt',
  'summary',
  'budget',
  'allowed',
  'settings',
  'chatModel',
];

/** The keys that may also be null (to clear them): the type their value has otherwise, and the refusal. */
const NULLABLE: Partial<Record<keyof PersonaPatchInput, readonly ['number' | 'string', string]>> = {
  budget: ['number', 'budget is a number of dollars or null'],
  model: ['string', 'model is a model id or null (the next free model of the class)'],
  chatModel: ['string', 'chatModel is a model id or null'],
};

/** One key's value as the patch carries it: the shape checked, or the refusal. */
function valueOf(key: keyof PersonaPatchInput, value: unknown): Parsed<unknown> {
  const nullable = NULLABLE[key];
  if (nullable !== undefined) {
    return value === null || typeof value === nullable[0] ? { ok: true, value } : { ok: false, error: nullable[1] };
  }
  switch (key) {
    case 'skills':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? { ok: true, value: value.map((v) => (v as string).trim()) }
        : { ok: false, error: `${key} is a list of names` };
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
