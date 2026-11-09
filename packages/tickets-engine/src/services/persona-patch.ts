import { PERSONA_ROLES } from '../core/persona';

/** The PATCH body's shape (U4). */
export interface PersonaPatchFields {
  title?: string;
  role?: string;
  worker?: string;
  model?: string;
  pool?: readonly string[];
  color?: string;
  skills?: readonly string[];
  prompt?: string;
}

/** One rule: the field is sent and broken → the reason. */
type Rule = readonly [(input: PersonaPatchFields) => boolean, string];

const blank = (value: string | undefined): boolean => value !== undefined && value.trim() === '';

const RULES: readonly Rule[] = [
  [(i) => blank(i.title), 'the title is not empty'],
  [(i) => i.role !== undefined && !(PERSONA_ROLES as readonly string[]).includes(i.role), `the role is one of ${PERSONA_ROLES.join(', ')}`],
  [(i) => blank(i.worker), 'the worker is not empty ("opencode", "claude-code", "kimi" or "api")'],
  [(i) => blank(i.model), 'the default model is not empty'],
  [(i) => i.pool !== undefined && (i.pool.length === 0 || i.pool.some((m) => typeof m !== 'string' || m.trim() === '')), 'the model pool is a non-empty list of model names'],
  [(i) => i.color !== undefined && !/^#[0-9a-f]{6}$/i.test(i.color.trim()), 'the color is a #rrggbb hex value'],
  [(i) => i.skills !== undefined && i.skills.some((s) => typeof s !== 'string'), 'the skills are a list of skill names'],
  [(i) => i.prompt !== undefined && typeof i.prompt !== 'string', 'the prompt is markdown text'],
];

/** The PATCH body's validation (U4): only the listed rules reject; null = the patch is writable. */
export function personaPatchError(input: PersonaPatchFields): string | null {
  return RULES.find(([broken]) => broken(input))?.[1] ?? null;
}
