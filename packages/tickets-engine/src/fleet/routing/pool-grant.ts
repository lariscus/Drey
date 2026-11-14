import type { CapabilityClass, ClassRequest, FilteredSlot, PoolDecision, PoolEntry, PoolGrantDecision, PoolWaitDecision, RouteRecord, SlotView } from '../protocol';
import type { Ledgers } from './ledgers';
import { UNTABLED_COST } from './model-table';
import { Refusals } from './pool-refusals';
import type { PoolSettingsView } from './pool-settings';
import type { RouteCandidate, RouteOption } from './route-candidate';
import type { RouteRecorder } from './route-recorder';
import type { SlotFit } from './slot-fit';
import type { StepUp } from './step-up';
import type { SurplusChoice } from './surplus-choice';

export type { ProviderThrottle } from './slot-fit';

/** What the pool needs of the slot registry. */
export interface PoolSlots {
  views(): readonly SlotView[];
}

export interface PoolGrantDeps {
  readonly slots: PoolSlots;
  readonly settings: PoolSettingsView;
  readonly ledgers: Ledgers;
  /** req-178's stages: the hard filter per slot, the soft choice, the step up, the decision's record. */
  readonly fit: SlotFit;
  readonly choice: SurplusChoice;
  readonly stepUp: StepUp;
  readonly recorder: RouteRecorder;
}

/** What one pass over the options found: the candidates that passed, the refusals, the filtered slots. */
interface Sweep {
  readonly candidates: RouteCandidate[];
  readonly refusals: Refusals;
  readonly filtered: FilteredSlot[];
}

/**
 * The pool's one decision (req-170, R10, with req-178's routing): a session
 * gets a model of exactly the class it asked for, from its pool, on a free
 * slot, while the caps, the ledgers and the
 * reserve have room — or it waits. Among the slots that pass the filter the
 * largest surplus wins (same surplus → cheaper), and above `Upgrade above q`
 * the slot runs the next stronger model of the pool. Never a smaller class;
 * a model the table does not hold runs only on a request without a class (a
 * pinned model) or while the table is empty. A row the owner switched off
 * (req-287) is never granted.
 */
export class PoolGrant {
  constructor(private readonly deps: PoolGrantDeps) {}

  choose(request: ClassRequest): PoolDecision {
    const full = this.deps.ledgers.fullFor({ ticket: request.ticket, persona: request.persona, input: request.ledger });
    if (full !== null) {
      return { kind: 'wait', reason: 'ledger', line: `waits: ${full.line}`, detail: full.line, ledger: full };
    }
    const options = this.optionsOf(request);
    if (options.length === 0) {
      const what = request.class === null ? 'no model the table holds' : `no class ${request.class} model`;
      const detail = `${request.persona ?? request.ticket}'s pool holds ${what} — add one in Settings → Models`;
      return { kind: 'wait', reason: 'config', line: `waits: ${detail}`, detail };
    }
    const sweep = this.sweep(options, request);
    const chosen = this.deps.choice.pick(sweep.candidates, request.prefer);
    if (chosen === null) {
      return this.waitOf(request, sweep.refusals);
    }
    const stepped = this.deps.stepUp.consider(chosen, request, this.viewsOf(chosen.provider));
    const route = this.deps.recorder.record({ request, chosen, stepped, filtered: sweep.filtered });
    return this.grantOf(stepped ?? chosen, request, route);
  }

  /** req-287: the rank of a class in the owner's list (0 = strongest). */
  rankOf(name: CapabilityClass): number {
    return this.deps.settings.order().rank(name);
  }

  /** req-288: every model the router may use, strongest class first (the table's order within a class), each provider and model once. */
  entries(): readonly PoolEntry[] {
    const order = this.deps.settings.order();
    const rows = this.deps.settings.table().rows.filter((row) => row.enabled);
    const ranked = rows.map((row, at) => ({ row, at })).sort((x, y) => order.rank(x.row.class) - order.rank(y.row.class) || x.at - y.at);
    const seen = new Set<string>();
    return ranked.flatMap(({ row }) => {
      const key = `${row.provider}/${row.model}`;
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [{ provider: row.provider, model: row.model }];
    });
  }

  /** The class the model table gives a pool entry (its first row); null when the table does not hold it. */
  classOf(entry: PoolEntry): CapabilityClass | null {
    return entry.model === null ? null : (this.deps.settings.table().rowsOf(entry.model, entry.provider)[0]?.class ?? null);
  }

  /** The rows of the pool's entries that match the class, strongest entry first. */
  private optionsOf(request: ClassRequest): RouteOption[] {
    const table = this.deps.settings.table();
    return request.pool.flatMap((entry): RouteOption[] => {
      const rows = entry.model === null ? [] : table.rowsOf(entry.model, entry.provider);
      if (rows.length > 0) {
        return rows.filter((row) => row.enabled && (request.class === null || row.class === request.class)).map((row) => ({ row, entry, provider: row.provider }));
      }
      const untabledAllowed = request.class === null || table.empty;
      return untabledAllowed ? [{ row: null, entry, provider: entry.provider ?? request.provider }] : [];
    });
  }

  /** Every option on every slot that serves it: the filter's verdict for each. */
  private sweep(options: readonly RouteOption[], request: ClassRequest): Sweep {
    const sweep: Sweep = { candidates: [], refusals: new Refusals(), filtered: [] };
    options.forEach((option, order) => {
      const views = this.viewsOf(option.provider);
      for (const view of this.servingSlots(option, views, sweep)) {
        const refusal = this.deps.fit.refusal(option, view, request, views);
        if (refusal === null) {
          sweep.candidates.push({ ...option, view, order });
          continue;
        }
        sweep.refusals.add(refusal.reason, refusal.text);
        if (refusal.ledger !== undefined) {
          sweep.refusals.ledger = refusal.ledger;
        }
        sweep.filtered.push({ slot: view.id, model: option.row?.model ?? option.entry.model, reason: refusal.short ?? refusal.text });
      }
    });
    return sweep;
  }

  /** The slots that serve the option's row (a row may name its one slot, req-290: every slot may serve every repository). */
  private servingSlots(option: RouteOption, views: readonly SlotView[], sweep: Sweep): readonly SlotView[] {
    const model = option.row?.model ?? option.entry.model;
    const serving = views.filter((view) => option.row === null || option.row.slot === null || option.row.slot === view.id);
    if (serving.length === 0) {
      sweep.refusals.add('config', `${model ?? option.provider} is served on no slot`);
    }
    return serving;
  }

  private viewsOf(provider: RouteOption['provider']): readonly SlotView[] {
    return this.deps.slots.views().filter((view) => view.provider === provider);
  }

  private grantOf(candidate: RouteCandidate, request: ClassRequest, route: RouteRecord): PoolGrantDecision {
    const { row, view } = candidate;
    const model = row?.model ?? candidate.entry.model;
    const what = row === null ? `${model ?? 'the default model'} (not in the model table)` : `${row.model}, class ${row.class}, cost ${row.cost}`;
    const step = route.stepUp !== null ? `, a step up from ${route.stepUp.from} (q ${String(route.q)})` : '';
    const reason = `${what} on ${view.label}${step} — ${request.why}`;
    return { kind: 'grant', slot: { id: view.id, label: view.label }, provider: candidate.provider, model, class: row?.class ?? null, cost: row?.cost ?? UNTABLED_COST, reason, route };
  }

  private waitOf(request: ClassRequest, refusals: Refusals): PoolWaitDecision {
    const reason = refusals.worst();
    const detail = refusals.lines.map((line) => line.text).join('; ');
    if (reason === 'ledger' && refusals.ledger !== null) {
      return { kind: 'wait', reason, line: `waits: ${refusals.ledger.line}`, detail, ledger: refusals.ledger };
    }
    const target = request.class ?? request.pool[0]?.model ?? request.provider;
    return { kind: 'wait', reason, line: reason === 'capacity' ? `waits for a ${target} slot` : `waits: ${detail}`, detail };
  }
}
