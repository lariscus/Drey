import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CREW_IDS, shippedPersonaOf, type ShippedPersona } from '../core/default-crew';

/** `packages/tickets-engine/personas/` from the source tree and from `dist-electron/packages/tickets-engine/`. */
export const SHIPPED_PERSONAS_DIR = path.join(__dirname, '..', '..', 'personas');

/** What the package ships for the default crew, and what did not read. */
export interface ShippedCrew {
  readonly personas: readonly ShippedPersona[];
  /** One line per shipped persona that did not read; such a persona is not seeded. */
  readonly problems: readonly string[];
}

/** Where the seeder reads the shipped crew from. */
export interface ShippedCrewSource {
  load(): Promise<ShippedCrew>;
}

/** The shipped crew read from the package's files (`personas/<id>/…`). */
export class ShippedCrewFiles implements ShippedCrewSource {
  constructor(
    private readonly dir: string = SHIPPED_PERSONAS_DIR,
  ) {}

  async load(): Promise<ShippedCrew> {
    const personas: ShippedPersona[] = [];
    const problems: string[] = [];
    for (const id of DEFAULT_CREW_IDS) {
      const personaText = await this.read(path.join(this.dir, id, 'persona.md'));
      const promptText = await this.read(path.join(this.dir, id, 'prompt.md'));
      if (personaText === null || promptText === null) {
        problems.push(`shipped persona ${id}: persona.md or prompt.md is missing from the package`);
        continue;
      }
      const shipped = shippedPersonaOf(id, personaText, promptText);
      if (typeof shipped === 'string') {
        problems.push(shipped);
      } else {
        personas.push(shipped);
      }
    }
    return { personas, problems };
  }

  private read(file: string): Promise<string | null> {
    return fsp.readFile(file, 'utf8').catch(() => null);
  }
}
