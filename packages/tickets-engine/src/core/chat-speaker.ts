/**
 * Who speaks in the Shape and the Flow chat (req-272, the persona board
 * concept §7): a persona of the crew, picked from the ticket's chain. Pure.
 *
 * - **Shape** is the chain's interactive entry — the one marked `:shape`, in
 *   the ticket's own chain, else in the standard flow a ticket is copied
 *   from (`paul:shape; ben; …` by default; a ticket created before
 *   chains carries none).
 * - **Flow** is the persona of the ticket's **plan entry**: the first
 *   entry (of the chain, else of the standard flow — a `:shape` entry too:
 *   since req-305 it shapes and then plans at one position) whose persona
 *   hands over a plan, not code — its gate is structural ({@link personaGate},
 *   the planner's default); without one it is the shape persona.
 *
 * Only an agent of the crew can speak: an entry that names a persona the
 * crew no longer has, the human or Mission Control's persona yields null —
 * the caller then speaks with the mode's wrapper alone (Shape) or asks which
 * persona to ask (Flow). Roles carry no logic here (concept §8).
 */
import type { ChainEntry } from '../contracts/chain';
import { isAgentPersona, type Persona } from './persona';
import { personaGate } from './persona-settings';

function agentOf(id: string | undefined, personas: readonly Persona[]): Persona | null {
  const persona = id === undefined ? undefined : personas.find((candidate) => candidate.id === id);
  return persona !== undefined && isAgentPersona(persona) ? persona : null;
}

/** The persona of the interactive entry; the ticket's own chain first, the standard flow after it. */
export function shapeSpeakerOf(chain: readonly ChainEntry[], standard: readonly ChainEntry[], personas: readonly Persona[]): Persona | null {
  const own = agentOf(chain.find((entry) => entry.mode === 'shape')?.persona, personas);
  return own ?? agentOf(standard.find((entry) => entry.mode === 'shape')?.persona, personas);
}

/** The persona of the ticket's plan entry, else the shape persona. */
export function flowSpeakerOf(chain: readonly ChainEntry[], standard: readonly ChainEntry[], personas: readonly Persona[]): Persona | null {
  for (const entry of chain.length > 0 ? chain : standard) {
    const persona = agentOf(entry.persona, personas);
    if (persona !== null && personaGate(persona) === 'structural') {
      return persona;
    }
  }
  return shapeSpeakerOf(chain, standard, personas);
}
