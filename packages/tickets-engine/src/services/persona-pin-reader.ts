import { pinsOf, type PersonaPins } from '../core/persona-removal';
import { parsePipeline } from '../core/ticket-board';
import type { CrewConfigFiles } from './crew-config-files';
import type { EngineHost, EngineVault } from './host';

const PIPELINE_FILE = 'tickets/_meta/pipeline.md';

/** What the board's two files say about a persona (req-261): read as they are on disk, never cached. */
export interface PersonaPinPort {
  pinsOf(vault: EngineVault, personaId: string): Promise<PersonaPins>;
}

/**
 * Reads `_meta/pipeline.md` (the columns that pin a persona with
 * `persona: <id>`) and `_meta/crew.md` (`default-persona`). A file that is
 * absent or does not parse pins nobody — a deletion is not blocked by a
 * board file the engine cannot read.
 */
export class PersonaPinReader implements PersonaPinPort {
  constructor(
    private readonly host: Pick<EngineHost, 'read'>,
    private readonly crew: Pick<CrewConfigFiles, 'read'>,
  ) {}

  async pinsOf(vault: EngineVault, personaId: string): Promise<PersonaPins> {
    const [pipeline, crew] = await Promise.all([this.host.read(vault.id, PIPELINE_FILE).catch(() => null), this.crew.read(vault)]);
    const phases = pipeline === null ? [] : parsePipeline(pipeline).phases;
    const crewDefault = crew.parse.config.values.defaultPersona;
    return pinsOf(personaId, phases, typeof crewDefault === 'string' ? crewDefault : null);
  }
}
