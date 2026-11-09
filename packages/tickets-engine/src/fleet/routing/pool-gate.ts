import type { ClassRequest, PoolDecision, PoolGrantRecord, RunLedgerInput, RunRequest } from '../protocol';
import { slotEnv } from './slot';
import type { SlotRegistry } from './slot-registry';
import type { SlotReservations } from './slot-reservations';

/** What the gate needs of the registry. */
export type SlotDirectory = Pick<SlotRegistry, 'find' | 'announce'>;

/** What the gate needs of the pool's decision. */
export interface PoolChooser {
  choose(request: ClassRequest): PoolDecision;
}

/** The context a start brings besides its request. */
export interface GateContext {
  readonly prefer: string | null;
  readonly persona: string | null;
}

/** No ledger input on the request: the Settings defaults decide, no spending above the allowance. */
export const DEFAULT_LEDGER_INPUT: RunLedgerInput = { allowance: null, personaBudget: null, spendAboveAllowance: false };

/** A start's request as the pool reads it: its one model, of its class when it names one. */
export function classRequestOf(request: RunRequest, context: GateContext): ClassRequest {
  return {
    ticket: request.ticketId,
    persona: context.persona,
    class: request.poolClass ?? null,
    pool: [{ provider: request.provider, model: request.model }],
    provider: request.provider,
    profile: request.profile ?? 'private',
    contextTokens: null,
    ledger: request.ledger ?? DEFAULT_LEDGER_INPUT,
    prefer: context.prefer,
    why: request.poolWhy ?? 'the start names its model',
  };
}

/**
 * Every start's door to the pool (req-170 over req-177): the request's model
 * on a slot of its provider and the repository's profile, of the class the
 * dispatch asked for, while the caps and the ledgers have room — its weight
 * reserved before the worker spawns, so two starts racing for the last room
 * cannot both win. A refusal spawns nothing.
 */
export class PoolGate {
  constructor(
    private readonly registry: SlotDirectory,
    private readonly reservations: SlotReservations,
    private readonly pool: PoolChooser,
  ) {}

  bind(request: RunRequest, runId: string, context: GateContext): { readonly id: string; readonly label: string; readonly grant: PoolGrantRecord } | { readonly refused: string } {
    const decision = this.pool.choose(classRequestOf(request, context));
    if (decision.kind === 'wait') {
      return { refused: decision.reason === 'capacity' ? `${decision.line} — ${decision.detail}` : decision.detail };
    }
    this.reservations.reserve(decision.slot.id, runId, { model: decision.model, class: decision.class, cost: decision.cost });
    this.registry.announce();
    const grant: PoolGrantRecord = { requested: request.poolClass ?? null, class: decision.class, model: decision.model ?? request.model ?? '', cost: decision.cost, reason: decision.reason };
    return { ...decision.slot, grant };
  }

  release(runId: string): void {
    if (this.reservations.release(runId) !== null) {
      this.registry.announce();
    }
  }

  envOf(slotId: string): Readonly<Record<string, string>> | undefined {
    const slot = this.registry.find(slotId);
    return slot === null ? undefined : slotEnv(slot);
  }
}
