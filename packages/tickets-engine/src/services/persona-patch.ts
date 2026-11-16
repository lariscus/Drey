import type { PersonaAllowedPatch } from '../contracts/persona-allowed';
import { settingsPatchError, type PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import type { ChatPersonaPatch } from '../contracts/chat';
import { classNameOf } from '../contracts/capability-class';
import { PERSONA_ROLES, PERSONA_RUN_COMMANDS, type Persona } from '../core/persona/persona';
import { MIGRATION_FALLBACK_CLASS } from '../core/persona/persona-model-migration';

/** The PATCH body's shape (U4). */
export interface PersonaPatchFields {
  title?: string;
  role?: string;
  /** req-288: the capability class (a name of the owner's list). */
  class?: string;
  /** req-288: the pinned model as a pool entry; null or '' = the next free model of the class. */
  model?: string | null;
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
  [(i) => i.class !== undefined && classNameOf(i.class) === null, 'the class is a class name of Settings → Models (super heavy, heavy, standard, light or a class the owner added)'],
  [(i) => i.model !== undefined && i.model !== null && (typeof i.model !== 'string' || i.model.length > 200), 'the model is a model id of at most 200 characters, or null for the next free model of the class'],
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

/**
 * What a patchPersona card may change on THIS persona (req-315): the chat's
 * write surface per kind. The human never runs — only their title, summary,
 * instructions and the leaving actions are theirs; Mission Control's persona
 * never runs a ticket — she takes her profile, her instructions, her chat
 * model and her skills. null = the patch fits the kind.
 */
export function chatPatchRefusalOf(persona: Pick<Persona, 'kind'>, patch: ChatPersonaPatch): string | null {
  if (persona.kind === 'agent') {
    return null;
  }
  const sent = (key: keyof ChatPersonaPatch): boolean => patch[key] !== undefined;
  if (persona.kind === 'human') {
    const stray = (['role', 'class', 'model', 'chatModel', 'budget', 'skills', 'allowed'] as const).filter(sent);
    const settings = patch.settings;
    const straySettings = settings === undefined ? [] : Object.keys(settings).filter((key) => key !== 'leaving');
    return stray.length + straySettings.length === 0
      ? null
      : "the owner's persona takes only their title, summary, instructions and leaving actions";
  }
  const stray = (['role', 'class', 'model', 'budget', 'allowed', 'settings'] as const).filter(sent);
  return stray.length === 0 ? null : "Mission Control's persona takes only her title, summary, instructions, chat model and skills";
}

/**
 * A patch's `class` and `model` over the record (req-288): the sent class
 * replaces the record's, the sent model pins it (null or '' = the next free
 * model of the class). A record not migrated yet is migrated by the patch —
 * its v2 keys leave — taking its old floor, else the fallback class, when
 * only a model is sent.
 */
export function withModelPatch(persona: Persona, input: Pick<PersonaPatchFields, 'class' | 'model'>): Persona {
  if (persona.kind !== 'agent' || (input.class === undefined && input.model === undefined)) {
    return persona;
  }
  const { legacy, ...rest } = persona;
  const named = input.class !== undefined ? classNameOf(input.class) : null;
  return { ...rest, class: named ?? persona.class ?? legacy?.minClass ?? MIGRATION_FALLBACK_CLASS, model: pinAfter(persona.model, input.model) };
}

/** The pin after a patch: unsent keeps it, null or blank clears it. */
function pinAfter(current: string | null, sent: string | null | undefined): string | null {
  if (sent === undefined) {
    return current;
  }
  const pin = (sent ?? '').trim();
  return pin === '' ? null : pin;
}
