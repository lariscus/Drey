import type { BoardSnapshot, PipelinePhase, TicketCard } from '../../contracts/tickets';
import { personaModelFor, type PersonaModelChoice } from '../../core/persona';
import { parseWorkerValue, resolveAssignment } from '../assignment';
import { isWorkerProvider, type ChainConfig, type WorkerProviderId } from '../protocol';
import type { TicketPersona } from './board-personas';
import type { SupervisorDirectory } from './supervisor-directory';

type FreeSlots = Readonly<Partial<Record<WorkerProviderId, number>>>;

/**
 * Which provider pool a card's run takes, for one pass (E3, D-62): a
 * resolved persona's pool and router pick the model — and with it the
 * provider — against the planner's free slots at that point of the pass;
 * without a persona the assignment ring decides. The dispatch reads the
 * same model choice back.
 */
export class PassPools {
  private readonly choices = new Map<string, PersonaModelChoice>();

  constructor(
    private readonly config: ChainConfig,
    private readonly snap: BoardSnapshot,
    private readonly personas: ReadonlyMap<string, TicketPersona>,
    private readonly directory: SupervisorDirectory,
  ) {}

  readonly poolOf = (card: TicketCard, phase: PipelinePhase, free: FreeSlots = {}): WorkerProviderId | null => this.personaPool(card, phase, free) ?? this.ringPool(card, phase);

  choiceOf(cardId: string): PersonaModelChoice | null {
    return this.choices.get(cardId) ?? null;
  }

  /** The persona's choice: the chosen pool entry's provider, else the persona's harness; null without a persona. */
  private personaPool(card: TicketCard, phase: PipelinePhase, free: FreeSlots): WorkerProviderId | null {
    const persona = this.personas.get(card.id)?.persona ?? null;
    const parsed = persona === null ? null : parseWorkerValue(persona.worker);
    if (persona === null || parsed === null) {
      return null;
    }
    const choice = personaModelFor(persona, { phase: phase.id, provider: parsed.provider, freeSlots: free, failedRuns: this.directory.failedRunsInColumn(card.id, phase.id) });
    this.choices.set(card.id, choice);
    return choice.provider !== null && isWorkerProvider(choice.provider) ? choice.provider : parsed.provider;
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
