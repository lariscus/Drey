import type { PersonaRemoveFailure } from '../contracts/persona-remove';
import { HUMAN_PERSONA_ID, isHumanPersona, isMissionPersona, type Persona } from './persona';

/** What pins a persona on the board: the pipeline columns that name it and the crew's default persona. */
export interface PersonaPins {
  /** The titles of the columns with `persona: <id>`. */
  readonly columns: readonly string[];
  readonly crewDefault: boolean;
}

/** The run states that mean a worker is at work or standing for the next line. */
const LIVE_STATES: readonly string[] = ['starting', 'running', 'stopping'];

/** A run record as far as the removal reads it: any kind of session, a ticket run included. */
export interface RemovalRun {
  readonly persona?: string | null;
  readonly state: string;
}

/** True while the persona has a live or held run, 1:1 or free session. */
export function hasLiveSession(runs: readonly RemovalRun[], personaId: string): boolean {
  return runs.some((run) => run.persona === personaId && LIVE_STATES.includes(run.state));
}

/** The pins of one persona over the pipeline's phases and the crew's default persona. */
export function pinsOf(personaId: string, phases: readonly { readonly title: string; readonly persona: string | null }[], crewDefault: string | null): PersonaPins {
  return {
    columns: phases.filter((phase) => phase.persona === personaId).map((phase) => phase.title),
    crewDefault: crewDefault !== null && crewDefault.trim() === personaId,
  };
}

export interface RemovalFacts {
  readonly persona: Persona;
  readonly confirm: string;
  readonly live: boolean;
  readonly pins: PersonaPins;
}

/**
 * The first reason a persona is not deleted, or null. The order is the
 * order the owner can act on: the human persona and Mission Control's
 * persona (req-269) are never candidates, a busy persona must be stopped
 * first, a pinned one unpinned first — and the typed title is checked
 * last, so a refusal never depends on what was typed.
 */
export function removalRefusal(facts: RemovalFacts): PersonaRemoveFailure | null {
  const { persona } = facts;
  if (persona.id === HUMAN_PERSONA_ID || isHumanPersona(persona)) {
    return { ok: false, code: 'human', error: 'the owner\'s own persona is not deleted' };
  }
  if (isMissionPersona(persona)) {
    return { ok: false, code: 'mission', error: `${persona.title} is Mission Control's persona — edit the prompt instead` };
  }
  if (facts.live) {
    return { ok: false, code: 'busy', error: `${persona.title} has a live or held run or 1:1 — stop it first` };
  }
  if (facts.pins.columns.length > 0 || facts.pins.crewDefault) {
    const where = [...facts.pins.columns.map((title) => `the column ${title}`), ...(facts.pins.crewDefault ? ['the crew\'s default persona'] : [])];
    return { ok: false, code: 'pinned', error: `${persona.title} is pinned by ${where.join(' and ')} — unpin it first`, columns: facts.pins.columns, crewDefault: facts.pins.crewDefault };
  }
  if (facts.confirm !== persona.title) {
    return { ok: false, code: 'confirm', error: 'the typed name is not the persona\'s title' };
  }
  return null;
}
