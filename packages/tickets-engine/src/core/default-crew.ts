import { stripPromptVersion } from './default-prompts';
import { parsePersonaFile, personaFileText, type Persona, type PersonaModels, type PersonaRole } from './persona';

/**
 * The default crew (req-256, decision D7): planner Paul, builder Ben,
 * reviewer Ralf, tester Tessa — and, since req-269, Pia, Mission Control's
 * own persona (`kind: mission`) — shipped as files under
 * `packages/tickets-engine/personas/<id>/{persona,prompt}.md` and seeded
 * into a board's `tickets/_meta/personas/` ({@link CrewSeeder}). The
 * shipped `persona.md` has no `worker:` and no `models:` key: those are
 * the vault's, filled at seeding (never for Pia, who runs no session). The
 * shipped `prompt.md` is the persona's "who it is" part (R11, the prompt is
 * the persona); the seeded one of an agent adds the step text of its role
 * below it, because a persona's prompt replaces the step prompt as the
 * run's instruction base. Pia's is seeded as shipped: Mission Control
 * composes it before its own prompt on every turn.
 */

/** The ids the engine ships, in crew order — Mission Control's persona first (the concept §12). */
export const DEFAULT_CREW_IDS: readonly string[] = ['pia', 'paul', 'ben', 'ralf', 'tessa'];

/** The roles a shipped persona may have, and the shipped step prompt each one runs (and the word its heading uses). */
export const CREW_STEPS: Readonly<Partial<Record<PersonaRole, { readonly ref: string; readonly name: string }>>> = {
  planner: { ref: 'plan-default', name: 'planning' },
  builder: { ref: 'build-default', name: 'build' },
  reviewer: { ref: 'review-default', name: 'review' },
  tester: { ref: 'qa-default', name: 'verify' },
};

/** One shipped persona as read from the package: its parsed record and the "who it is" prose. */
export interface ShippedPersona {
  readonly id: string;
  /** `persona.md` parsed — `worker` and `models` here are the parser's defaults, never what is seeded. */
  readonly persona: Persona;
  /** `prompt.md`, newline-terminated, opening with `## Who <title> is`. */
  readonly who: string;
}

/** True when the shipped record is a crew member the package may ship: an agent of a stepped role, or Mission Control's persona. */
function isShippable(persona: Persona): boolean {
  return persona.kind === 'mission' || (persona.kind === 'agent' && CREW_STEPS[persona.role] !== undefined);
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

/**
 * The `persona.md` a vault gets: the shipped record with the vault's
 * worker and, when the model table names one for it, the models; without
 * models the parser's default stays (the file then names it, like any
 * persona the writer saves). A mission persona's file carries neither.
 */
export function seededPersonaText(shipped: ShippedPersona, worker: string, models: PersonaModels | null): string {
  return personaFileText({ ...shipped.persona, worker, ...(models === null ? {} : { models }) });
}

/**
 * The `prompt.md` a vault gets: the shipped "who it is" part, then the
 * shipped step prompt of the role (its version marker dropped) under its
 * own heading. `stepMissing` when the package holds no step prompt for the
 * role — the persona then seeds with its character alone and the caller
 * says so. Mission Control's persona has no step: her prompt is seeded as shipped.
 */
export function seededPromptText(shipped: ShippedPersona, steps: ReadonlyMap<string, string>): { readonly text: string; readonly stepMissing: boolean } {
  const step = shipped.persona.kind === 'mission' ? undefined : CREW_STEPS[shipped.persona.role];
  if (step === undefined) {
    return { text: shipped.who, stepMissing: shipped.persona.kind !== 'mission' };
  }
  const body = steps.get(step.ref);
  if (body === undefined) {
    return { text: shipped.who, stepMissing: true };
  }
  return { text: `${shipped.who}\n## The ${step.name} step\n\n${stripPromptVersion(body).trim()}\n`, stepMissing: false };
}
