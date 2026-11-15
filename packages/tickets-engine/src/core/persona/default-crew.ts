import { stripPromptVersion } from '../config/default-prompts';
import { parsePersonaFile, personaFileText, type Persona } from './persona';

/**
 * The default crew (req-256, decision D7): planner Paul, builder Ben,
 * reviewer Ralf, tester Tessa — and, since req-269, Pia, Mission Control's
 * own persona (`kind: mission`) — shipped as files under
 * `packages/tickets-engine/personas/<id>/{persona,prompt}.md` and seeded
 * into a board's `tickets/_meta/personas/` ({@link CrewSeeder}). The
 * shipped `persona.md` of an agent names its `class:` and pins no model
 * (req-288: the next free model of the class runs; Pia runs no session).
 * The shipped `prompt.md` is the persona's "who it is" part (R11, the
 * prompt is the persona) — its role knowledge; the run brief carries the
 * disciplines. Pia's is seeded as shipped: Mission Control composes it
 * before its own prompt on every turn.
 */

/** The ids the engine ships, in crew order — Mission Control's persona first (the concept §12). */
export const DEFAULT_CREW_IDS: readonly string[] = ['pia', 'paul', 'ben', 'ralf', 'tessa'];

/** One shipped persona as read from the package: its parsed record and the "who it is" prose. */
export interface ShippedPersona {
  readonly id: string;
  /** `persona.md` parsed. */
  readonly persona: Persona;
  /** `prompt.md`, newline-terminated, opening with `## Who <title> is`. */
  readonly who: string;
}

/** True when the shipped record is a crew member the package may ship: an agent of a stepped role, or Mission Control's persona. */
function isShippable(persona: Persona): boolean {
  return persona.kind === 'mission' || (persona.kind === 'agent' && ['planner', 'builder', 'reviewer', 'tester'].includes(persona.role));
}

/** The persona, or why the shipped files are not a crew member (a broken package never seeds half a persona). */
export function shippedPersonaOf(id: string, personaText: string, promptText: string): ShippedPersona | string {
  const persona = parsePersonaFile(id, personaText);
  if (!isShippable(persona)) {
    return `shipped persona ${id}: its role must be planner, builder, reviewer or tester, or its kind mission`;
  }
  const who = promptText.replace(/\r\n/g, '\n');
  if (!who.startsWith(`## Who ${persona.title} is\n`)) {
    return `shipped persona ${id}: prompt.md must open with "## Who ${persona.title} is"`;
  }
  return { id, persona, who: who.endsWith('\n') ? who : `${who}\n` };
}

/** The `persona.md` a vault gets: the shipped record as the writer writes it (its class, no pinned model, req-288). */
export function seededPersonaText(shipped: ShippedPersona): string {
  return personaFileText(shipped.persona);
}

/** The `prompt.md` a vault gets: the shipped "who it is" part, as shipped. */
export function seededPromptText(shipped: ShippedPersona): string {
  return stripPromptVersion(shipped.who);
}
