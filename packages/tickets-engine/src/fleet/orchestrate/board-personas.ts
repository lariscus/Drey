import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { crewLookupOf, holderOf, type TicketHolder } from '../../core/chain-holder';
import { EDGE_STAGES } from '../../core/lifecycle-stages';
import { PERSONAS_DIR, loadPersonaSkills, parsePersonaFile, resolvePersona, type Persona, type PersonaResolution, type PersonaSkill } from '../../core/persona';
import type { FileSystem } from '../ports/file-system';
import type { ChainConfig } from '../protocol';

/**
 * One ticket's persona for a pass (E3, ADR-0088; req-257): the chain's
 * holder on a lifecycle store, the column's persona on the phase board, and
 * the loaded persona — null when nothing resolves or the file is
 * missing/unreadable (no persona, no run).
 */
export interface TicketPersona {
  /** Which level decided ('chain' | 'phase' | 'none'). */
  readonly resolution: PersonaResolution;
  readonly persona: Persona | null;
  /** The persona's prompt.md; null when absent. */
  readonly prompt: string | null;
  /** The persona's memory.md ('' when absent). */
  readonly memory: string;
  /** The texts of the skills its record names (D-46). */
  readonly skills: readonly PersonaSkill[];
}

/** Says a per-ticket reason once (the chain log's notes). */
export type Note = (key: string, line: string) => void;

/** A ticket's holder on a lifecycle store (req-257) and, for an agent holder, its loaded persona. */
export interface HeldTicket {
  readonly holder: TicketHolder;
  readonly entry: TicketPersona;
}

/** The read cache of one pass. */
type FileOf = (rel: string) => Promise<string | null>;

/**
 * Who works each ticket of the board, once per pass through one read cache:
 * on the phase board the column's `persona:` (E3; the ticket pin and the
 * engine default retired with req-257), on a lifecycle store the chain's
 * holder ({@link resolveHolders}). An absent or unreadable persona is no
 * persona — the pass never fails on one bad persona, and nothing runs for it.
 */
export class BoardPersonas {
  constructor(
    private readonly note: Note,
    private readonly fs: FileSystem,
  ) {}

  async resolve(config: ChainConfig, snap: BoardSnapshot): Promise<Map<string, TicketPersona>> {
    const fileOf = this.cacheFor(config);
    const personas = new Map<string, TicketPersona>();
    for (const column of snap.columns) {
      for (const card of column.tickets) {
        const resolution = resolvePersona({ phasePersona: column.phase.persona });
        personas.set(card.id, await this.load(resolution, card, fileOf));
      }
    }
    return personas;
  }

  /**
   * req-257: every ticket's holder on a lifecycle store (the concept's holder rule over its chain and
   * cursor), with the agent holder's persona loaded. A ticket in a lifecycle column has none.
   */
  async resolveHolders(config: ChainConfig, snap: BoardSnapshot): Promise<Map<string, HeldTicket>> {
    const fileOf = this.cacheFor(config);
    const lookup = crewLookupOf(await this.crewKinds(config, fileOf));
    const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? null;
    const held = new Map<string, HeldTicket>();
    for (const column of snap.columns) {
      const stage = column.phase.id === terminal ? 'done' : EDGE_STAGES.includes(column.phase.id) ? column.phase.id : 'active';
      for (const card of column.tickets) {
        const holder = holderOf({ stage, chain: card.meta.chain, at: card.meta.at, awaiting: card.meta.awaiting }, lookup);
        const runs = holder.kind === 'entry' && holder.work === 'run';
        const resolution: PersonaResolution = runs ? { persona: holder.persona, source: 'chain' } : { persona: null, source: 'none' };
        held.set(card.id, { holder, entry: await this.load(resolution, card, fileOf) });
      }
    }
    return held;
  }

  /** The crew's persona kinds from the meta vault's `personas/` folders (unreadable records left out). */
  private async crewKinds(config: ChainConfig, fileOf: FileOf): Promise<Map<string, Persona['kind']>> {
    const kinds = new Map<string, Persona['kind']>();
    for (const id of await this.fs.list(this.fs.join(config.ticketsVaultPath, PERSONAS_DIR))) {
      const text = await fileOf(`${PERSONAS_DIR}/${id}/persona.md`);
      const persona = text === null ? null : parsed(id, text);
      if (persona !== null) {
        kinds.set(persona.id, persona.kind);
      }
    }
    return kinds;
  }

  /** One pass's read cache over the meta vault. */
  private cacheFor(config: ChainConfig): FileOf {
    const cache = new Map<string, Promise<string | null>>();
    return (rel) => {
      let hit = cache.get(rel);
      if (hit === undefined) {
        hit = this.fs.readTextOrNull(this.fs.join(config.ticketsVaultPath, rel));
        cache.set(rel, hit);
      }
      return hit;
    };
  }

  /** The persona file of an id, or null when absent / unreadable. */
  async read(config: ChainConfig, id: string): Promise<Persona | null> {
    const text = await this.fs.readTextOrNull(this.fs.join(config.ticketsVaultPath, PERSONAS_DIR, id, 'persona.md'));
    return text === null ? null : parsed(id, text);
  }

  private async load(resolution: PersonaResolution, card: TicketCard, fileOf: FileOf): Promise<TicketPersona> {
    const none: TicketPersona = { resolution, persona: null, prompt: null, memory: '', skills: [] };
    if (resolution.persona === null) {
      return none;
    }
    const text = await fileOf(`${PERSONAS_DIR}/${resolution.persona}/persona.md`);
    const persona = text === null ? null : parsed(resolution.persona, text);
    if (persona === null) {
      return none;
    }
    const loaded = await loadPersonaSkills(fileOf, persona.id, persona.skills);
    loaded.warnings.forEach((warning, i) => this.note(`${card.id}:skill-name:${i}`, `persona ${persona.id}: ${warning}`));
    if (loaded.missing.length > 0) {
      this.note(`${card.id}:skills`, `persona ${persona.id}: no text for skill ${loaded.missing.join(', ')} - ${card.id} runs without it`);
    }
    return {
      resolution,
      persona,
      prompt: await fileOf(`${PERSONAS_DIR}/${persona.id}/prompt.md`),
      memory: (await fileOf(`${PERSONAS_DIR}/${persona.id}/memory.md`)) ?? '',
      skills: loaded.skills,
    };
  }
}

/** An invalid persona file is no persona. */
function parsed(id: string, text: string): Persona | null {
  try {
    return parsePersonaFile(id, text);
  } catch {
    return null;
  }
}
