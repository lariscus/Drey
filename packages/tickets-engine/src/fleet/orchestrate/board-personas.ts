import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { manualStepAfter } from '../../core/manual-gate';
import { HUMAN_PERSONA_ID, PERSONAS_DIR, isHumanPersona, loadPersonaSkills, parsePersonaFile, resolvePersona, type Persona, type PersonaResolution, type PersonaSkill } from '../../core/persona';
import type { FileSystem } from '../ports/file-system';
import type { ChainConfig } from '../protocol';

/**
 * One ticket's persona for a pass (E3, ADR-0088): the ladder's winner and
 * the loaded persona — null when nothing resolves or the file is
 * missing/unreadable (the assignment ring then runs unchanged).
 */
export interface TicketPersona {
  /** Which level decided ('ticket' | 'phase' | 'default' | 'none'). */
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

/**
 * The persona ladder for every ticket of the board (E3): ticket `persona:`
 * > the phase's `persona:` > the engine's default, resolved once per pass
 * through one read cache. An absent or unreadable persona degrades to the
 * ring — the pass never fails on one bad persona.
 */
export class BoardPersonas {
  constructor(
    private readonly note: Note,
    private readonly fs: FileSystem,
  ) {}

  async resolve(config: ChainConfig, snap: BoardSnapshot): Promise<Map<string, TicketPersona>> {
    const cache = new Map<string, Promise<string | null>>();
    const fileOf = (rel: string): Promise<string | null> => {
      let hit = cache.get(rel);
      if (hit === undefined) {
        hit = this.fs.readTextOrNull(this.fs.join(config.ticketsVaultPath, rel));
        cache.set(rel, hit);
      }
      return hit;
    };
    const personas = new Map<string, TicketPersona>();
    for (const column of snap.columns) {
      for (const card of column.tickets) {
        const resolution = resolvePersona({ ticketPersona: card.meta.persona, phasePersona: column.phase.persona, defaultPersona: config.defaultPersona ?? null });
        personas.set(card.id, await this.load(resolution, card, fileOf));
      }
    }
    return personas;
  }

  /** The persona file of an id, or null when absent / unreadable. */
  async read(config: ChainConfig, id: string): Promise<Persona | null> {
    const text = await this.fs.readTextOrNull(this.fs.join(config.ticketsVaultPath, PERSONAS_DIR, id, 'persona.md'));
    return text === null ? null : parsed(id, text);
  }

  /**
   * The human persona a manual step after `workingPhaseId` waits for (E10-6),
   * or null when the card's chain holds none. A step with no pin is the
   * owner's (`you`); a pin on an agent persona is no manual step (said once).
   */
  async manualParkFor(config: ChainConfig, snap: BoardSnapshot, card: TicketCard, workingPhaseId: string): Promise<string | null> {
    const entries = card.meta.chain ?? [];
    const step = entries.length === 0 ? null : manualStepAfter(snap.pipeline.map((p) => ({ id: p.id, title: p.title })), workingPhaseId, entries);
    if (step === null) {
      return null;
    }
    const id = step.persona ?? HUMAN_PERSONA_ID;
    const persona = await this.read(config, id);
    if (persona !== null && !isHumanPersona(persona)) {
      this.note(card.id, `dispatch: the manual step of ${card.id} names "${id}", which is an agent - the step is ignored`);
      return null;
    }
    return id;
  }

  private async load(resolution: PersonaResolution, card: TicketCard, fileOf: (rel: string) => Promise<string | null>): Promise<TicketPersona> {
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

/** An invalid persona file degrades to the ring. */
function parsed(id: string, text: string): Persona | null {
  try {
    return parsePersonaFile(id, text);
  } catch {
    return null;
  }
}
