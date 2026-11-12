import { isMissionPersona, PERSONAS_DIR, type Persona } from '../core/persona';
import type { EngineHost, EngineVault } from './host';

/** The board as the reader needs it: the vault and the crew in its order. */
export interface MissionPersonaBoard {
  detect(): Promise<EngineVault | null>;
  listPersonas(): Promise<readonly Persona[]>;
}

/**
 * Mission Control's persona prompt (req-269): the `prompt.md` of the crew's
 * `kind: mission` persona — Pia as shipped; the first one in the crew's
 * order should a board hold two. Read from disk on every call (the owner's
 * edit on the Persona page applies on the next Mission Control turn) and
 * never cached; folded to LF and trimmed. Null when there is no vault, no
 * mission persona, or no or an empty `prompt.md` — Mission Control then
 * speaks with its own prompt alone. Never throws.
 */
export class MissionPersonaPrompt {
  constructor(
    private readonly board: MissionPersonaBoard,
    private readonly host: Pick<EngineHost, 'read'>,
  ) {}

  async text(): Promise<string | null> {
    try {
      const vault = await this.board.detect();
      if (vault === null) {
        return null;
      }
      const persona = (await this.board.listPersonas()).find((candidate) => isMissionPersona(candidate));
      if (persona === undefined) {
        return null;
      }
      const raw = await this.host.read(vault.id, `${PERSONAS_DIR}/${persona.id}/prompt.md`);
      const text = (raw ?? '').replace(/\r\n/g, '\n').trim();
      return text === '' ? null : text;
    } catch {
      return null;
    }
  }
}
