import type { PersonaRemoveFailure } from '../../contracts/persona-remove';
import { HUMAN_PERSONA_ID, isHumanPersona, isMissionPersona, type Persona } from './persona';

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

export interface RemovalFacts {
  readonly persona: Persona;
  readonly confirm: string;
  readonly live: boolean;
}

/**
 * The first reason a persona is not deleted, or null. The order is the
 * order the owner can act on: the human persona and Mission Control's
 * persona (req-269) are never candidates, a busy persona must be stopped
 * first — and the typed title is checked last, so a refusal never
 * depends on what was typed.
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
  if (facts.confirm !== persona.title) {
    return { ok: false, code: 'confirm', error: 'the typed name is not the persona\'s title' };
  }
  return null;
}
