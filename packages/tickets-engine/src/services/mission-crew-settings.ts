/**
 * The `## Crew settings` block of a mission turn (req-315): the fields a
 * patchPersona card may set, with their CURRENT values per persona — read
 * fresh on every turn, so a rename or a re-pin applies on the next message.
 * The prompt texts are deliberately NOT here (owner, 2026-11-15): the model
 * reads one on demand through `persona_read`, before it patches it. Pure
 * formatting over the board's persona records.
 */
import { isHumanPersona, isMissionPersona, type Persona } from '../core/persona/persona';

const onOff = (value: boolean | null | undefined): string => (value === true ? 'on' : 'off');
const list = (values: readonly string[]): string => (values.length === 0 ? 'none' : values.join(', '));

/** One persona's values line: what a patchPersona card may set on THIS kind, as it stands. */
export function crewSettingsLineOf(persona: Persona): string {
  if (isHumanPersona(persona)) {
    return humanLine(persona);
  }
  if (isMissionPersona(persona)) {
    return missionLine(persona);
  }
  return agentLine(persona);
}

/** The owner's line: title, summary, instructions and the leaving actions are theirs; everything run-related is inert. */
function humanLine(persona: Persona): string {
  return `- ${persona.id} (${persona.title}) — the owner, human. title, summary, prompt, leaving: ${list(persona.settings.leaving)} are theirs; everything run-related is inert. summary: ${persona.summary === '' ? 'none' : persona.summary}`;
}

/** Mission Control's line: her profile, instructions, chat model and skills; class, model, budget, rights and run settings are inert. */
function missionLine(persona: Persona): string {
  return [
    `- ${persona.id} (${persona.title}) — Mission Control, kind mission.`,
    `title, summary, prompt, chat model: ${persona.chatModel ?? "(the assistant's)"} · skills: ${list(persona.skills)} are hers; class, model, budget, rights and run settings are inert.`,
    `summary: ${persona.summary === '' ? 'none' : persona.summary}`,
  ].join(' ');
}

/** An agent's line: the page's fields as they stand. */
function agentLine(persona: Persona): string {
  const settings = persona.settings;
  return [
    `- ${persona.id} (${persona.title}) — agent, role ${persona.role}.`,
    `class: ${persona.class ?? 'none'} · model: ${persona.model ?? '(the class decides)'} · budget: ${persona.budget === null ? 'none' : `$${persona.budget}`} · max in parallel: ${settings.parallel ?? 'unset'} · min: ${settings.min ?? 0} · read-only: ${onOff(settings.readOnly)} · leaving: ${list(settings.leaving)} · skills: ${list(persona.skills)}`,
    `allowed: spend above allowance ${onOff(persona.allowed.spendAboveAllowance)}, run commands: ${persona.allowed.runCommands ?? '(the crew setting)'}, network ${onOff(persona.allowed.network)}, write notes ${onOff(persona.allowed.writeNotes)} · summary: ${persona.summary === '' ? 'none' : persona.summary}`,
  ].join(' ');
}

/** The block; null when the board has no persona at all. */
export function crewSettingsBlockOf(personas: readonly Persona[]): string | null {
  if (personas.length === 0) {
    return null;
  }
  return [
    '## Crew settings',
    '',
    'What a patchPersona command may set, per persona, as it stands right now — only the sent keys change. A "prompt" replaces the persona\'s whole instructions file: read it with persona_read first, never patch it unseen. The field shapes are in the command list above; an unknown persona id is refused.',
    '',
    ...personas.map(crewSettingsLineOf),
  ].join('\n');
}

/** What the chat service asks of the block — the crew block's own source interface fits. */
export interface CrewSettingsSource {
  text(): Promise<string | null>;
}

/** The block read on every turn (a re-pin or a rename applies on the next message). */
export class MissionCrewSettings implements CrewSettingsSource {
  constructor(private readonly personas: () => Promise<readonly Persona[]>) {}

  async text(): Promise<string | null> {
    const personas = await this.personas().catch(() => [] as readonly Persona[]);
    return crewSettingsBlockOf(personas);
  }
}
