/**
 * Who speaks in the Shape chat (req-272, the persona board
 * concept §7): a persona of the crew, picked from the ticket's chain. Pure.
 *
 * The speaker is the chain's interactive entry — the one marked `:shape`, in
 * the ticket's own chain, else in the standard flow a ticket is copied
 * from (`paul:shape; ben; …` by default; a ticket created before
 * chains carries none).
 *
 * Only an agent of the crew can speak: an entry that names a persona the
 * crew no longer has, the human or Mission Control's persona yields null —
 * the caller then speaks with the mode's wrapper alone. Roles carry no logic
 * here (concept §8).
 */
import type { ChainEntry } from '../../contracts/chain';
import { isAgentPersona, type Persona } from '../persona/persona';

function agentOf(id: string | undefined, personas: readonly Persona[]): Persona | null {
  const persona = id === undefined ? undefined : personas.find((candidate) => candidate.id === id);
  return persona !== undefined && isAgentPersona(persona) ? persona : null;
}

/** The persona of the interactive entry; the ticket's own chain first, the standard flow after it. */
export function shapeSpeakerOf(chain: readonly ChainEntry[], standard: readonly ChainEntry[], personas: readonly Persona[]): Persona | null {
  const own = agentOf(chain.find((entry) => entry.mode === 'shape')?.persona, personas);
  return own ?? agentOf(standard.find((entry) => entry.mode === 'shape')?.persona, personas);
}
