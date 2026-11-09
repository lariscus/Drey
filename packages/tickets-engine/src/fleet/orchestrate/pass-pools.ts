import type { BoardSnapshot, PipelinePhase, TicketCard } from '../../contracts/tickets';
import { parseWorkerValue, resolveAssignment } from '../assignment';
import type { ChainConfig, WorkerProviderId } from '../protocol';
import type { TicketPersona } from './board-personas';

/**
 * Which provider pool a card's run counts against in the dispatch plan, for
 * one pass (req-63, E3): with the capacity pool wired (req-170) a persona's
 * card counts against none — the pool grants its class on whichever
 * provider holds it; without it the persona's harness; without a persona
 * the assignment ring decides.
 */
export class PassPools {
  constructor(
    private readonly config: ChainConfig,
    private readonly snap: BoardSnapshot,
    private readonly personas: ReadonlyMap<string, TicketPersona>,
    private readonly classPool: boolean,
  ) {}

  readonly poolOf = (card: TicketCard, phase: PipelinePhase): WorkerProviderId | null => {
    const persona = this.personas.get(card.id)?.persona ?? null;
    const parsed = persona === null ? null : parseWorkerValue(persona.worker);
    if (parsed !== null) {
      return this.classPool ? null : parsed.provider;
    }
    return this.ringPool(card, phase);
  };

  /** True when the card's run asks the capacity pool for its class. */
  asksPool(card: TicketCard): boolean {
    const persona = this.personas.get(card.id)?.persona ?? null;
    return this.classPool && persona !== null && parseWorkerValue(persona.worker) !== null;
  }

  /** The assignment ring: ticket, column, repo, the configured default. */
  private ringPool(card: TicketCard, phase: PipelinePhase): WorkerProviderId | null {
    const repo = card.meta.repo === null ? null : (this.snap.repos.find((r) => r.name === card.meta.repo) ?? null);
    const assignment = resolveAssignment({
      ticketWorker: card.meta.worker,
      columnWorker: phase.worker,
      columnModel: phase.model,
      handover: phase.handover,
      repoWorker: repo?.worker ?? null,
      configuredDefault: this.config.defaultWorker,
    });
    return assignment.ok ? assignment.provider : null;
  }
}
