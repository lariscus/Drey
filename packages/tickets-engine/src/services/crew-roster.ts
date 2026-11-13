import { isAgentPersona, type Persona } from '../core/persona';

/**
 * The crew as a shape turn lists it (req-272): the personas a plan part may
 * name — the agents, in the order they were given (`listPersonas` returns
 * `crew.md`'s order) — one line each, `- <id> (<title>): <what it does>`,
 * the persona's own `summary:` line, else its role label. The human and
 * Mission Control's persona do not build a part, so they are left out.
 * Empty crew = ''.
 */
export function crewRosterOf(personas: readonly Persona[]): string {
  return personas
    .filter((persona) => isAgentPersona(persona))
    .map((persona) => `- ${persona.id} (${persona.title}): ${persona.summary === '' ? persona.role : persona.summary}`)
    .join('\n');
}
