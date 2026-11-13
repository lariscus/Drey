import type { PersonaAllowedPatch } from '../contracts/persona-allowed';
import { settingsPatchError, type PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import { PERSONA_ROLES, PERSONA_RUN_COMMANDS } from '../core/persona';

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
  summary?: string;
  /** The daily budget in USD; null clears it (req-171). */
  budget?: number | null;
  allowed?: PersonaAllowedPatch;
  /** req-258: the run settings. */
  settings?: PersonaSettingsPatch;
  /** req-293: Mission Control's persona's chat model; null or '' = the assistant's own. */
  chatModel?: string | null;
}

const isBool = (value: unknown): boolean => value === undefined || typeof value === 'boolean';

function allowedBroken(allowed: PersonaAllowedPatch): boolean {
  if (typeof allowed !== 'object' || allowed === null) {
    return true;
  }
  const commands = allowed.runCommands;
  return (
    !isBool(allowed.spendAboveAllowance) ||
    !isBool(allowed.network) ||
    !isBool(allowed.writeNotes) ||
    !(commands === undefined || commands === null || (PERSONA_RUN_COMMANDS as readonly string[]).includes(commands))
  );
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
  [(i) => i.summary !== undefined && (typeof i.summary !== 'string' || i.summary.length > 200), 'the one line for the crew list is text of at most 200 characters'],
  [(i) => i.budget !== undefined && i.budget !== null && !(typeof i.budget === 'number' && Number.isFinite(i.budget) && i.budget >= 0), 'the daily budget is a number of dollars, zero or more, or null'],
  [(i) => i.chatModel !== undefined && i.chatModel !== null && (typeof i.chatModel !== 'string' || i.chatModel.length > 200), 'the chat model is a model id of at most 200 characters, or null for the assistant\'s model'],
  [(i) => i.allowed !== undefined && allowedBroken(i.allowed), 'allowed is { spendAboveAllowance?, runCommands?, network?, writeNotes? } with run-commands accept-edits or bypass'],
];

/** The PATCH body's validation (U4): only the listed rules reject; null = the patch is writable. */
export function personaPatchError(input: PersonaPatchFields): string | null {
  return RULES.find(([broken]) => broken(input))?.[1] ?? (input.settings !== undefined ? settingsPatchError(input.settings) : null);
}
