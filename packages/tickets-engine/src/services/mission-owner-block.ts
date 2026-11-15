/**
 * The `## The owner` block of a mission turn (req-315, the owner's request:
 * "im Umgang mit mir soll Pia berücksichtigen, was in der You-Persona
 * steht"): the human persona's `prompt.md` — how the owner wants to be
 * dealt with, in their own words. Found by `kind: human`, never by name —
 * a retitle ("You" → anything) changes nothing. Read fresh on every turn;
 * a board whose owner wrote no instructions carries no block.
 */
import { isHumanPersona, PERSONAS_DIR, type Persona } from '../core/persona/persona';
import type { EngineHost, EngineVault } from './host';

/** The board as the block read needs it (`MissionPersonaPrompt`'s board fits). */
export interface OwnerBlockBoard {
  detect(): Promise<EngineVault | null>;
  listPersonas(): Promise<readonly Persona[]>;
}

/** What the chat service asks of the block — the crew block's own source interface fits. */
export interface OwnerBlockSource {
  text(): Promise<string | null>;
}

/** The block's text over an owner prompt; pure, so the shape stays in one place. */
export function ownerBlockOf(title: string, prompt: string): string {
  return [`## The owner`, '', `${title} is the owner — this is their persona's own instructions for how you deal with them; honor it in every answer:`, '', prompt.trim()].join('\n');
}

export class MissionOwnerBlock implements OwnerBlockSource {
  constructor(
    private readonly board: OwnerBlockBoard,
    private readonly host: Pick<EngineHost, 'read'>,
  ) {}

  async text(): Promise<string | null> {
    try {
      const vault = await this.board.detect();
      if (vault === null) {
        return null;
      }
      const persona = (await this.board.listPersonas()).find((candidate) => isHumanPersona(candidate));
      if (persona === undefined) {
        return null;
      }
      const prompt = ((await this.host.read(vault.id, `${PERSONAS_DIR}/${persona.id}/prompt.md`).catch(() => '')) ?? '').replace(/\r\n/g, '\n').trim();
      return prompt === '' ? null : ownerBlockOf(persona.title, prompt);
    } catch {
      return null;
    }
  }
}
