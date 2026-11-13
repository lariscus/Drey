import type { PipelinePhase, TicketCard } from '../../contracts/tickets';
import { mergeNeeds } from '../../core/model-needs';
import { splitPoolEntry, type Persona } from '../../core/persona';
import { CAPABILITY_CLASSES, isWorkerProvider, PART_SIZE_CLASS, type CapabilityClass, type ClassRequest, type PoolEntry, type WorkerProviderId } from '../protocol';

/** What the builder needs of the pool: the class the model table gives a pool entry. */
export interface ClassLookup {
  classOf(entry: PoolEntry): CapabilityClass | null;
}

/** One dispatch as the builder reads it. */
export interface ClassRequestInput {
  readonly card: TicketCard;
  readonly phase: PipelinePhase;
  readonly persona: Persona;
  /** req-178: the slot the ticket's last run lived on (its session can only continue there); null = none. */
  readonly prefer?: string | null;
}

const rank = (c: CapabilityClass): number => CAPABILITY_CLASSES.indexOf(c);
const stronger = (a: CapabilityClass, b: CapabilityClass): CapabilityClass => (rank(a) <= rank(b) ? a : b);

/** The lightest class of the set that is stronger than `than`; null when none is. */
function lightestAbove(held: ReadonlySet<CapabilityClass>, than: CapabilityClass): CapabilityClass | null {
  return [...held].filter((c) => rank(c) < rank(than)).sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/**
 * Who asks for which class (req-170, ADR-0095's assumption as built): a
 * ticket pin `model:` asks for that model (its row's class), a pin `class:`
 * for exactly that class; otherwise the plan part's `size:` (S → C, M → B,
 * L → A) or — unsized — the class of the persona's default model, raised to
 * the phase's `min-class:` floor. A size or floor the persona's pool holds
 * no model of is raised to the nearest stronger class it does hold —
 * raised, never lowered. req-178: the phase's and the ticket's `needs:` ride
 * along for the routing's filter; a pin forbids the step up.
 */
export class ClassRequestBuilder {
  constructor(private readonly lookup: ClassLookup) {}

  build(input: ClassRequestInput): ClassRequest {
    const { card, persona } = input;
    const provider = this.providerOf(persona);
    const pool = persona.models.pool.map((entry) => this.entryOf(entry));
    // req-258: the persona's own needs replace the column's when its record names any.
    const needs = mergeNeeds(persona.settings.needs ?? input.phase.needs, card.meta.needs);
    const base = {
      ticket: card.id,
      persona: persona.id,
      provider,
      contextTokens: null,
      ...(needs !== null ? { needs } : {}),
      ledger: { allowance: card.meta.allowance ?? null, personaBudget: persona.budget, spendAboveAllowance: persona.allowed.spendAboveAllowance },
      prefer: input.prefer ?? null,
    } as const;
    const pinnedModel = card.meta.model ?? null;
    if (pinnedModel !== null) {
      return { ...base, class: null, pool: [this.entryOf(pinnedModel)], why: `${card.id} pins model ${pinnedModel}` };
    }
    const pinnedClass = card.meta.class ?? null;
    if (pinnedClass !== null) {
      return { ...base, class: pinnedClass, pool, why: `${card.id} pins class ${pinnedClass}` };
    }
    const asked = this.asked(input, pool);
    return { ...base, class: asked.class, pool, why: asked.why, stepUp: true };
  }

  /** The size or the persona's default, the floor over it, the pool's own classes after. */
  private asked(input: ClassRequestInput, pool: readonly PoolEntry[]): { class: CapabilityClass | null; why: string } {
    const floored = this.floored(input);
    if (floored.class === null) {
      return { class: null, why: `${input.persona.id}'s default runs (its models are not in the model table)` };
    }
    const held = new Set(pool.map((entry) => this.lookup.classOf(entry)).filter((c): c is CapabilityClass => c !== null));
    const raised = held.has(floored.class) ? floored.class : (lightestAbove(held, floored.class) ?? floored.class);
    const step = raised !== floored.class ? `raised to ${raised}, the lightest class ${input.persona.id}'s pool holds above ${floored.class}` : null;
    return { class: raised, why: [...floored.why, ...(step !== null ? [step] : [])].join(', ') };
  }

  /** The size's class (or the default model's), raised to the phase's floor. */
  private floored(input: ClassRequestInput): { class: CapabilityClass | null; why: string[] } {
    const size = input.card.meta.size ?? null;
    const sized = size === null ? null : PART_SIZE_CLASS[size];
    const fallback = this.lookup.classOf(this.entryOf(input.persona.models.default));
    const start = sized ?? fallback;
    // req-258: the persona's own floor wins over the column's when its record names one.
    const own = input.persona.settings.minClass;
    const floor = own ?? input.phase.minClass ?? null;
    const floorWhy = own !== null ? `floor ${floor} of ${input.persona.id}` : `floor ${floor} in ${input.phase.id}`;
    if (start === null) {
      return { class: floor, why: floor === null ? [] : [floorWhy] };
    }
    const why = [size !== null ? `size ${size} → ${sized}` : `${input.persona.id}'s default class ${fallback}`];
    if (floor !== null && stronger(start, floor) !== start) {
      return { class: floor, why: [...why, floorWhy] };
    }
    return { class: start, why };
  }

  private entryOf(raw: string): PoolEntry {
    const { provider, model } = splitPoolEntry(raw);
    return { provider: provider !== null && isWorkerProvider(provider) ? provider : null, model };
  }

  private providerOf(persona: Persona): WorkerProviderId {
    const head = persona.worker.split('/')[0] ?? '';
    return isWorkerProvider(head) ? head : 'opencode';
  }
}
