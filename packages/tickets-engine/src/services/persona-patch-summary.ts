/**
 * What a patchPersona card says (req-315): per sent field one
 * `field: old → new` part against the persona's record — the card's summary
 * line, so the owner sees exactly what a confirm would write. Pure: the
 * record and the patch in, the parts out. The prompt's diff is the chat
 * service's (it reads the file).
 */
import type { ChatPersonaPatch } from '../contracts/chat';
import type { Persona } from '../core/persona/persona';

/** A value as the card shows it, clipped so one card stays one line. */
function clip(value: string, max = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat === '' ? '""' : flat;
}

const quoted = (value: string): string => `“${clip(value)}”`;
const onOff = (value: boolean | null | undefined): string => (value === true ? 'on' : 'off');
const money = (value: number | null): string => (value === null ? 'none' : `$${value}`);
const list = (values: readonly string[]): string => (values.length === 0 ? '(none)' : values.join(', '));

/** The `field: old → new` parts of one patch, in the fields' fixed order; only sent fields appear. */
export function personaPatchPartsOf(persona: Persona, patch: ChatPersonaPatch): readonly string[] {
  return [
    ...profilePartsOf(persona, patch),
    ...classPartsOf(persona, patch),
    ...poolPartsOf(persona, patch),
    ...allowedPartsOf(persona, patch.allowed),
    ...settingsPartsOf(persona, patch.settings),
  ];
}

/** The profile fields: title, role, summary. */
function profilePartsOf(persona: Persona, patch: ChatPersonaPatch): readonly string[] {
  const parts: string[] = [];
  if (patch.title !== undefined) {
    parts.push(`title ${quoted(persona.title)} → ${quoted(patch.title)}`);
  }
  if (patch.role !== undefined) {
    parts.push(`role ${persona.role} → ${patch.role}`);
  }
  if (patch.summary !== undefined) {
    parts.push(`summary ${quoted(persona.summary)} → ${quoted(patch.summary)}`);
  }
  return parts;
}

/** The class fields: class, the pinned model, Mission Control's chat model. */
function classPartsOf(persona: Persona, patch: ChatPersonaPatch): readonly string[] {
  const parts: string[] = [];
  if (patch.class !== undefined) {
    parts.push(`class ${persona.class ?? 'none'} → ${patch.class}`);
  }
  if (patch.model !== undefined) {
    parts.push(`model ${pinSide(persona.model)} → ${pinSide(patch.model)}`);
  }
  const chatModel = chatModelPartOf(persona, patch);
  if (chatModel !== null) {
    parts.push(chatModel);
  }
  return parts;
}

/** One side of the model pair: the pin, or what a null or blank means. */
function pinSide(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '(the class decides)' : clip(value);
}

/** The chat-model part; null when the patch does not carry it. */
function chatModelPartOf(persona: Persona, patch: ChatPersonaPatch): string | null {
  if (patch.chatModel === undefined) {
    return null;
  }
  const current = persona.chatModel === null || persona.chatModel === undefined || persona.chatModel === '' ? "(the assistant's)" : clip(persona.chatModel);
  const next = patch.chatModel === null || patch.chatModel === '' ? "(the assistant's)" : clip(patch.chatModel);
  return `chat model ${current} → ${next}`;
}

/** The pool fields: the daily budget and the skills. */
function poolPartsOf(persona: Persona, patch: ChatPersonaPatch): readonly string[] {
  const parts: string[] = [];
  if (patch.budget !== undefined) {
    parts.push(`budget ${money(persona.budget)} → ${money(patch.budget)}`);
  }
  if (patch.skills !== undefined) {
    parts.push(`skills ${list(persona.skills)} → ${list(patch.skills)}`);
  }
  return parts;
}

function allowedPartsOf(persona: Persona, patch: ChatPersonaPatch['allowed']): readonly string[] {
  if (patch === undefined) {
    return [];
  }
  const parts: string[] = [];
  if (patch.spendAboveAllowance !== undefined) {
    parts.push(`spend above allowance ${onOff(persona.allowed.spendAboveAllowance)} → ${onOff(patch.spendAboveAllowance)}`);
  }
  if (patch.runCommands !== undefined) {
    const current = persona.allowed.runCommands ?? '(the crew setting)';
    const sent = patch.runCommands === null ? '(the crew setting)' : patch.runCommands;
    parts.push(`run commands ${current} → ${sent}`);
  }
  if (patch.network !== undefined) {
    parts.push(`network ${onOff(persona.allowed.network)} → ${onOff(patch.network)}`);
  }
  if (patch.writeNotes !== undefined) {
    parts.push(`write notes ${onOff(persona.allowed.writeNotes)} → ${onOff(patch.writeNotes)}`);
  }
  return parts;
}

function settingsPartsOf(persona: Persona, patch: ChatPersonaPatch['settings']): readonly string[] {
  if (patch === undefined) {
    return [];
  }
  const parts: string[] = [];
  const settings = persona.settings;
  if (patch.parallel !== undefined) {
    parts.push(`max in parallel ${settings.parallel ?? '(unset)'} → ${patch.parallel ?? '(unset)'}`);
  }
  if (patch.min !== undefined) {
    parts.push(`min ${settings.min ?? 0} → ${patch.min ?? 0}`);
  }
  if (patch.readOnly !== undefined) {
    parts.push(`read-only ${onOff(settings.readOnly)} → ${onOff(patch.readOnly)}`);
  }
  if (patch.leaving !== undefined) {
    parts.push(`leaving ${list(settings.leaving)} → ${list(patch.leaving)}`);
  }
  return parts;
}
