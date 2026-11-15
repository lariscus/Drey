import { parsePersonaFile, personaModelGuess, type Persona, type PersonaResolution } from '../core/persona/persona';

/**
 * The persona loader (ADR-0088, E3): the services read personas from the
 * tickets vault through one seam, so both the dispatcher (orchestrator)
 * and the manual start (board service) resolve them identically. Pure IO
 * shape: a vault-relative text reader is all it needs.
 */

export interface PersonaLoader {
  /** The parsed persona, or null when the directory/file is absent or unreadable. */
  load(id: string): Promise<Persona | null>;
  /** The persona's prompt file text; null when missing. */
  prompt(id: string): Promise<string | null>;
  /** The curated memory file text; '' when absent. */
  memory(id: string): Promise<string>;
}

export function personaLoader(read: (rel: string) => Promise<string>): PersonaLoader {
  const safe = async (rel: string): Promise<string | null> => {
    try {
      return await read(rel);
    } catch {
      return null;
    }
  };
  return {
    load: async (id) => {
      const text = await safe(`tickets/_meta/personas/${id}/persona.md`);
      return text === null ? null : parsePersonaFile(id, text);
    },
    prompt: (id) => safe(`tickets/_meta/personas/${id}/prompt.md`),
    memory: async (id) => (await safe(`tickets/_meta/personas/${id}/memory.md`)) ?? '',
  };
}

export interface ResolvedPersona {
  readonly persona: Persona | null;
  readonly resolution: PersonaResolution;
}

/**
 * Who works the ticket plus the load (req-257): the chain's holder; null
 * persona when nothing resolves or the file is gone.
 */
export async function resolvePersonaForTicket(
  loader: PersonaLoader,
  input: {
    readonly chainPersona?: string | null;
  },
): Promise<ResolvedPersona> {
  const chain = input.chainPersona ?? null;
  const resolution: PersonaResolution = chain !== null ? { persona: chain, source: 'chain' } : { persona: null, source: 'none' };
  if (resolution.persona === null) {
    return { persona: null, resolution };
  }
  const persona = await loader.load(resolution.persona);
  return { persona, resolution };
}

/**
 * What a run started outside the chain derives from a persona: the harness
 * and model of its pin (req-288; an estimate, the dialog's start), '' when it
 * pins none — the assignment ring then decides. The chain's dispatch asks the
 * capacity pool instead (req-170) — the class decides.
 */
export function deriveWorkerModel(persona: Persona): { workerChoice: string; model: string | null } {
  const guess = personaModelGuess(persona);
  return { workerChoice: guess?.provider ?? '', model: guess?.model ?? null };
}
