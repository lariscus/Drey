import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { isHumanPersona, type Persona } from '../../core/persona';
import { dispatchable, isAutoPhase } from '../chain';
import type { ChainConfig, ColumnMode } from '../protocol';
import type { BoardPersonas, TicketPersona } from './board-personas';
import type { ChainBoard } from './chain-board';
import type { RunBookkeeper } from './run-bookkeeper';

/** What one pass hands the human gates. */
export interface GatePass {
  readonly snap: BoardSnapshot;
  readonly resolved: ReadonlyMap<string, TicketPersona>;
  /** Each ticket parked joins it: busy for the rest of the pass. */
  readonly busy: Set<string>;
  readonly modes: Readonly<Record<string, ColumnMode>>;
}

/** Who works the card's current gate: the persona ladder's winner (req-266: the chain pins no column until req-257). */
function gatePersona(entry: TicketPersona | null): string | null {
  return entry?.resolution.persona ?? null;
}

/**
 * E10-6: a gate the human persona works runs no agent. Every dispatchable
 * ticket whose current gate is the human's (the delta's pin, then the
 * ticket / phase / default ladder) parks where it sits with `awaiting:` —
 * no run is composed, no worktree prepared — and lands in Needs you.
 */
export class HumanGates {
  constructor(
    private readonly board: ChainBoard,
    private readonly personas: BoardPersonas,
    private readonly bookkeeper: RunBookkeeper,
    private readonly log: (message: string) => void,
  ) {}

  async park(config: ChainConfig, pass: GatePass): Promise<void> {
    const door = this.board.door(config);
    if (door === null) {
      return;
    }
    for (const column of pass.snap.columns) {
      if (!isAutoPhase(column.phase) || (pass.modes[column.phase.id] ?? 'playing') !== 'playing') {
        continue;
      }
      for (const card of column.tickets) {
        const human = dispatchable(card, pass.busy) ? await this.humanOf(config, card, pass) : null;
        if (human === null) {
          continue;
        }
        pass.busy.add(card.id);
        const what = `parked for ${human.title} - the ${column.phase.title} gate is a manual step`;
        if (await this.bookkeeper.parkInPlace(door, card, human.id, what)) {
          this.log(`parked ${card.id} for ${human.id}: ${what}`);
        }
      }
    }
  }

  /** The human persona that works the card's current gate, or null when an agent (or nobody) does. */
  private async humanOf(config: ChainConfig, card: TicketCard, pass: GatePass): Promise<Persona | null> {
    const entry = pass.resolved.get(card.id) ?? null;
    const id = gatePersona(entry);
    if (id === null) {
      return null;
    }
    const loaded = entry?.persona ?? null;
    const persona = loaded !== null && loaded.id === id ? loaded : await this.personas.read(config, id);
    return persona !== null && isHumanPersona(persona) ? persona : null;
  }
}
