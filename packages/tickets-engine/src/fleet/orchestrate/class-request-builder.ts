import type { PipelinePhase, TicketCard } from '../../contracts/tickets';
import { mergeNeeds } from '../../core/model-needs';
import { splitPoolEntry, type Persona } from '../../core/persona';
import { migratedModelOf } from '../../core/persona-model-migration';
import { isWorkerProvider, PART_SIZE_CLASS, type CapabilityClass, type ClassRequest, type PoolEntry, type WorkerProviderId } from '../protocol';

/** What the builder needs of the pool: the class the model table gives a pool entry, the rank of a class in the owner's list (req-287), and every model the router may use (req-288). */
export interface ClassLookup {
  classOf(entry: PoolEntry): CapabilityClass | null;
  /** 0 = the strongest class; a class the list does not hold ranks below every listed one. */
  rankOf(name: CapabilityClass): number;
  /** The table's enabled models, strongest class first (the table's order within a class); empty without a table. */
  entries(): readonly PoolEntry[];
}

/** One dispatch as the builder reads it. */
export interface ClassRequestInput {
  readonly card: TicketCard;
  readonly phase: PipelinePhase;
  readonly persona: Persona;
  /** req-178: the slot the ticket's last run lived on (its session can only continue there); null = none. */
  readonly prefer?: string | null;
}

/** The persona's own class and pin; an unmigrated v2 record read by the migration's rule. */
interface OwnModel {
  readonly class: CapabilityClass | null;
  readonly model: string | null;
}

/** The harness an untabled entry runs on when nothing names one. */
const FALLBACK_PROVIDER: WorkerProviderId = 'claude-code';

/**
 * Who asks for which class (req-170; Persona v3, req-288): a ticket pin
 * `model:` asks for that model alone; otherwise the persona's `class:` is the
 * run's class, raised — never lowered — by the ticket's `class:`, the plan
 * part's `size:` (S → light, M → standard, L → heavy) and the phase's
 * `min-class:` floor; the owner's class list ranks (req-287). The pool is
 * every model of the table the router may use, so the next free model of the
 * class runs. A persona pinned to one model runs that model while nothing
 * raised its class; a raise takes the next free model of the raised class.
 * req-178: the phase's and the ticket's `needs:` ride along for the routing's
 * filter; a pin forbids the step up.
 */
export class ClassRequestBuilder {
  constructor(private readonly lookup: ClassLookup) {}

  build(input: ClassRequestInput): ClassRequest {
    const { card, persona } = input;
    const own = this.ownOf(persona);
    const pinnedEntry = own.model === null ? null : this.entryOf(own.model);
    // req-258: the persona's own needs replace the column's when its record names any.
    const needs = mergeNeeds(persona.settings.needs ?? input.phase.needs, card.meta.needs);
    const base = {
      ticket: card.id,
      persona: persona.id,
      provider: this.providerOf(pinnedEntry),
      contextTokens: null,
      ...(needs !== null ? { needs } : {}),
      ledger: { allowance: card.meta.allowance ?? null, personaBudget: persona.budget, spendAboveAllowance: persona.allowed.spendAboveAllowance },
      prefer: input.prefer ?? null,
    } as const;
    const ticketModel = card.meta.model ?? null;
    if (ticketModel !== null) {
      return { ...base, class: null, pool: [this.entryOf(ticketModel)], why: `${card.id} pins model ${ticketModel}` };
    }
    const asked = this.asked(input, own.class);
    if (pinnedEntry !== null && !asked.raised) {
      return { ...base, class: null, pool: [pinnedEntry], why: `${persona.id} pins model ${own.model ?? ''}` };
    }
    return { ...base, class: asked.class, pool: this.poolOf(pinnedEntry), why: asked.why, stepUp: true };
  }

  /** The persona's class and pin; a v2 record (no `class:` yet) through the migration's rule. */
  private ownOf(persona: Persona): OwnModel {
    if (persona.class !== null || persona.legacy === undefined) {
      return { class: persona.class, model: persona.model };
    }
    const migrated = migratedModelOf(persona.legacy, { classOf: (provider, model) => this.lookup.classOf(this.entryOf(provider === null ? model : `${provider}/${model}`)), rank: (name) => this.lookup.rankOf(name) });
    return { class: migrated.class, model: migrated.model };
  }

  /** What may raise the persona's class: the ticket's class, the part's size, the phase's floor — each with why. */
  private raisersOf(input: ClassRequestInput): readonly { readonly name: CapabilityClass; readonly why: string }[] {
    const { card, phase } = input;
    const size = card.meta.size ?? null;
    const raisers: { readonly name: CapabilityClass; readonly why: string }[] = [];
    if (card.meta.class !== undefined && card.meta.class !== null) {
      raisers.push({ name: card.meta.class, why: `${card.id} asks for ${card.meta.class}` });
    }
    if (size !== null) {
      raisers.push({ name: PART_SIZE_CLASS[size], why: `size ${size} → ${PART_SIZE_CLASS[size]}` });
    }
    if (phase.minClass !== undefined && phase.minClass !== null) {
      raisers.push({ name: phase.minClass, why: `floor ${phase.minClass} in ${phase.id}` });
    }
    return raisers;
  }

  /** The persona's class raised by the ticket's class, the size and the phase's floor; `raised` when one of them lifted it. */
  private asked(input: ClassRequestInput, own: CapabilityClass | null): { class: CapabilityClass | null; why: string; raised: boolean } {
    const { persona } = input;
    const raisers = this.raisersOf(input);
    let current = own;
    const why = own === null ? [] : [`${persona.id}'s class ${own}`];
    for (const raiser of raisers) {
      if (current === null || this.lookup.rankOf(raiser.name) < this.lookup.rankOf(current)) {
        current = raiser.name;
        why.push(own === null && why.length === 0 ? raiser.why : `raised to ${raiser.name} (${raiser.why})`);
      }
    }
    if (current === null) {
      return { class: null, why: `${persona.id} names no class`, raised: false };
    }
    return { class: current, why: why.join(', '), raised: current !== own };
  }

  /** Every model the router may use; a machine without a table runs the pin, if there is one. */
  private poolOf(pinned: PoolEntry | null): readonly PoolEntry[] {
    const entries = this.lookup.entries();
    return entries.length === 0 && pinned !== null ? [pinned] : entries;
  }

  private entryOf(raw: string): PoolEntry {
    const { provider, model } = splitPoolEntry(raw);
    return { provider: provider !== null && isWorkerProvider(provider) ? provider : null, model };
  }

  /** The harness an untabled entry runs on: the pin's, else the table's first model's. */
  private providerOf(pinned: PoolEntry | null): WorkerProviderId {
    return pinned?.provider ?? this.lookup.entries()[0]?.provider ?? FALLBACK_PROVIDER;
  }
}
