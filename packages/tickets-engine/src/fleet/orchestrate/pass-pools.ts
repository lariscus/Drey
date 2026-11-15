import type { BoardSnapshot, TicketCard } from '../../contracts/tickets';
import { personaModelGuess } from '../../core/persona';
import { parseWorkerValue, resolveAssignment } from '../assignment';
import type { ChainConfig, WorkerProviderId } from '../protocol';
import type { TicketPersona } from './board-personas';

/**
 * Which provider pool a card's run counts against in the dispatch plan, for
 * one pass (req-63, E3): with the capacity pool wired (req-170) a persona's
 * card counts against none — the pool grants its class on whichever
 * provider holds it; without it the harness of the persona's pinned model;
 * otherwise the assignment ring decides.
 */
export class PassPools {
  constructor(
    private readonly config: ChainConfig,
    private readonly snap: BoardSnapshot,
    private readonly personas: ReadonlyMap<string, TicketPersona>,
    private readonly classPool: boolean,
  ) {}

  readonly poolOf = (card: TicketCard): WorkerProviderId | null => {
    const persona = this.personas.get(card.id)?.persona ?? null;
    if (persona !== null && this.classPool) {
      return null;
    }
    const guess = persona === null ? null : personaModelGuess(persona);
    const pinned = guess === null ? null : parseWorkerValue(guess.provider ?? '');
    return pinned !== null ? pinned.provider : this.ringPool(card);
  };

  /** True when the card's run asks the capacity pool for its class (req-288: every persona's run does, its harness follows from the grant). */
  asksPool(card: TicketCard): boolean {
    const persona = this.personas.get(card.id)?.persona ?? null;
    return this.classPool && persona !== null;
  }

  /** The assignment ring: ticket, repo, the configured default. */
  private ringPool(card: TicketCard): WorkerProviderId | null {
    const repo = card.meta.repo === null ? null : (this.snap.repos.find((r) => r.name === card.meta.repo) ?? null);
    const assignment = resolveAssignment({
      ticketWorker: card.meta.worker,
      repoWorker: repo?.worker ?? null,
      configuredDefault: this.config.defaultWorker,
    });
    return assignment.ok ? assignment.provider : null;
  }
}
