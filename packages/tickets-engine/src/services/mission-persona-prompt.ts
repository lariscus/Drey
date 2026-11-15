import { isMissionPersona, PERSONAS_DIR, type Persona } from '../core/persona/persona';
import { loadPersonaSkills } from '../core/skills/skill-load';
import type { EngineHost, EngineVault } from './host';
import { missionPersonaText } from './mission-persona-text';

/** The board as the prompt read needs it. */
export interface MissionPersonaBoard {
  detect(): Promise<EngineVault | null>;
  listPersonas(): Promise<readonly Persona[]>;
}

/**
 * Mission Control's persona as her turns read it (req-269, req-293,
 * req-294, req-296): the persona part of the system message — `prompt.md`,
 * her `memory.md` slice and her enabled skills ({@link missionPersonaText})
 * — and the chat model her `model:` pins. Read fresh on every turn, so an
 * edit applies on the next message; nothing read is null, never a throw (a
 * turn without her speaks with the mission prompt alone, on the assistant's
 * model).
 */
export class MissionPersonaPrompt {
  constructor(
    private readonly board: MissionPersonaBoard,
    private readonly host: Pick<EngineHost, 'read'>,
  ) {}

  async text(): Promise<string | null> {
    try {
      const found = await this.persona();
      if (found === null) {
        return null;
      }
      const { vault, persona } = found;
      const read = (rel: string): Promise<string | null> => this.host.read(vault.id, rel).catch(() => null);
      const dir = `${PERSONAS_DIR}/${persona.id}`;
      const [prompt, memory, skills] = await Promise.all([read(`${dir}/prompt.md`), read(`${dir}/memory.md`), loadPersonaSkills(read, persona.id, persona.skills)]);
      return missionPersonaText({ prompt: prompt ?? '', memory: memory ?? '', skills: skills.skills });
    } catch {
      return null;
    }
  }

  /** req-293: the model her `model:` pins; null = the assistant's own. */
  async model(): Promise<string | null> {
    try {
      const model = (await this.persona())?.persona.chatModel?.trim() ?? '';
      return model === '' ? null : model;
    } catch {
      return null;
    }
  }

  private async persona(): Promise<{ readonly vault: EngineVault; readonly persona: Persona } | null> {
    const vault = await this.board.detect();
    if (vault === null) {
      return null;
    }
    const persona = (await this.board.listPersonas()).find((candidate) => isMissionPersona(candidate));
    return persona === undefined ? null : { vault, persona };
  }
}
