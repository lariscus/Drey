import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { crewLookupOf, holderOf, type TicketHolder } from '../../core/pipeline/chain-holder';
import { EDGE_STAGES } from '../../core/pipeline/lifecycle-stages';
import { PERSONAS_DIR, loadPersonaSkills, parsePersonaFile, type Persona, type PersonaResolution, type PersonaSkill } from '../../core/persona/persona';
import type { FileSystem } from '../ports/file-system';
import type { ChainConfig } from '../protocol';

/**
 * One ticket's persona for a pass (E3, ADR-0088; req-257): the chain's
 * holder and the loaded persona — null when nothing resolves or the file
 * is missing/unreadable (no persona, no run).
 */
export interface TicketPersona {
  /** Which level decided ('chain' | 'none'). */
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
 * the chain's holder ({@link resolveHolders}). An absent or unreadable
 * persona is no persona — the pass never fails on one bad persona, and
 * nothing runs for it.
 */
export class BoardPersonas {
  constructor(
    private readonly note: Note,
    private readonly fs: FileSystem,
  ) {}

  /**
   * req-257: every ticket's holder on a lifecycle store (the concept's holder rule over its chain and
   * cursor), with the agent holder's persona loaded. A ticket in a lifecycle column has none.
   */
  async resolveHolders(config: ChainConfig, snap: BoardSnapshot): Promise<Map<string, HeldTicket>> {
    const fileOf = this.cacheFor(config);
    const held = new Map<string, HeldTicket>();
    for (const { card, holder } of await this.holdersWith(config, snap, fileOf)) {
      const runs = holder.kind === 'entry' && holder.work === 'run';
      const resolution: PersonaResolution = runs ? { persona: holder.persona, source: 'chain' } : { persona: null, source: 'none' };
      held.set(card.id, { holder, entry: await this.load(resolution, card, fileOf) });
    }
    return held;
  }

  /** req-274: every ticket's holder alone — the hold record's read while no persona is loaded (the Autopilot is off). */
  async holdersOf(config: ChainConfig, snap: BoardSnapshot): Promise<Map<string, TicketHolder>> {
    const holders = await this.holdersWith(config, snap, this.cacheFor(config));
    return new Map(holders.map(({ card, holder }) => [card.id, holder]));
  }

  /** The holder rule over every card of the snapshot, with one crew read. */
  private async holdersWith(config: ChainConfig, snap: BoardSnapshot, fileOf: FileOf): Promise<{ readonly card: TicketCard; readonly holder: TicketHolder }[]> {
    const lookup = crewLookupOf(await this.crewKinds(config, fileOf));
    const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? null;
    const out: { card: TicketCard; holder: TicketHolder }[] = [];
    for (const column of snap.columns) {
      const stage = column.phase.id === terminal ? 'done' : EDGE_STAGES.includes(column.phase.id) ? column.phase.id : 'active';
      for (const card of column.tickets) {
        out.push({ card, holder: holderOf({ stage, chain: card.meta.chain, at: card.meta.at, awaiting: card.meta.awaiting }, lookup) });
      }
    }
    return out;
  }

  /** req-257: who a plan run's `### Chain` may name — the crew with `you` — and who takes no mode (every non-agent). */
  async crewGuard(config: ChainConfig): Promise<{ readonly personas: readonly string[]; readonly modeless: readonly string[] }> {
    const kinds = await this.crewKinds(config, this.cacheFor(config));
    const personas = [...kinds.keys()];
    return { personas: personas.includes('you') ? personas : [...personas, 'you'], modeless: personas.filter((id) => kinds.get(id) !== 'agent') };
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
