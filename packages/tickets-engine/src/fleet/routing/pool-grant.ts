import type { ClassRequest, FullLedger, ModelRow, PoolDecision, PoolEntry, PoolGrantDecision, PoolWaitDecision, QueueReason, SlotView, WorkerProviderId } from '../protocol';
import type { CapacityCap } from './capacity-cap';
import type { Ledgers } from './ledgers';
import { UNTABLED_COST } from './model-table';
import { Refusals } from './pool-refusals';
import type { PoolSettingsView } from './pool-settings';
import type { SlotReservations } from './slot-reservations';

/** What the pool needs of the slot registry. */
export interface PoolSlots {
  views(): readonly SlotView[];
}

/**
 * A provider's own throttle (req-63's rule stands): a spent quota pauses it,
 * a rate limit or a local server's slot count lowers its ceiling. `base` is
 * the sessions its slots serve in all (null = unbounded).
 */
export interface ProviderThrottle {
  refusal(provider: WorkerProviderId, live: number, base: number | null): string | null;
}

export interface PoolGrantDeps {
  readonly slots: PoolSlots;
  readonly settings: PoolSettingsView;
  readonly cap: CapacityCap;
  readonly reservations: SlotReservations;
  readonly ledgers: Ledgers;
  readonly throttle?: ProviderThrottle;
}

/** One way a session could run: a row (or an untabled model) on a provider. */
interface Option {
  readonly row: ModelRow | null;
  readonly entry: PoolEntry;
  readonly provider: WorkerProviderId;
}

const blocked = (view: SlotView): string | null =>
  view.state === 'needs-login'
    ? `${view.label} needs a login (${view.reason ?? 'refused'})`
    : view.state === 'exhausted'
      ? `${view.label}: ${view.reason ?? 'quota spent'}`
      : view.total !== null && view.busy >= view.total
        ? `${view.label}: ${view.busy} of ${view.total} sessions busy`
        : null;

/**
 * The pool's one decision (req-170, R10): a session gets a model of exactly
 * the class it asked for, from its pool, on a free slot of the repository's
 * profile, while the caps and the ledgers have room — or it waits. Never a
 * smaller class; a model the table does not hold runs only on a request
 * without a class (a pinned model) or while the table is empty.
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
    const refusals = new Refusals();
    for (const option of options) {
      const grant = this.place(option, request, refusals);
      if (grant !== null) {
        return grant;
      }
    }
    return this.waitOf(request, refusals);
  }

  /** The rows of the pool's entries that match the class, strongest entry first. */
  private optionsOf(request: ClassRequest): Option[] {
    const table = this.deps.settings.table();
    return request.pool.flatMap((entry): Option[] => {
      const rows = entry.model === null ? [] : table.rowsOf(entry.model, entry.provider);
      if (rows.length > 0) {
        return rows.filter((row) => request.class === null || row.class === request.class).map((row) => ({ row, entry, provider: row.provider }));
      }
      const untabledAllowed = request.class === null || table.empty;
      return untabledAllowed ? [{ row: null, entry, provider: entry.provider ?? request.provider }] : [];
    });
  }

  /** The first slot this option fits on, or null with the reasons gathered. */
  private place(option: Option, request: ClassRequest, refusals: Refusals): PoolGrantDecision | null {
    const views = this.deps.slots.views().filter((view) => view.provider === option.provider);
    const serving = this.servingSlots(option, request, views, refusals);
    const ordered = [...serving.filter((v) => v.id === request.prefer), ...serving.filter((v) => v.id !== request.prefer)];
    for (const view of ordered) {
      const refusal = this.refusalOn(view, option, views);
      if (refusal === null) {
        return this.grantOf(option, view, request);
      }
      refusals.add(refusal.reason, refusal.text);
      if (refusal.ledger !== undefined) {
        refusals.ledger = refusal.ledger;
      }
    }
    return null;
  }

  /** The slots of the repository's profile that serve the option's row — never one of the other profile. */
  private servingSlots(option: Option, request: ClassRequest, views: readonly SlotView[], refusals: Refusals): readonly SlotView[] {
    const ofProfile = views.filter((view) => view.profile === request.profile);
    if (ofProfile.length === 0) {
      const other = request.profile === 'work' ? 'private' : 'work';
      refusals.add('config', `no ${request.profile} slot serves ${option.provider}: the repository is ${request.profile} and never runs on a ${other} slot — add a ${request.profile} slot for ${option.provider} to service.json`);
      return [];
    }
    const serving = ofProfile.filter((view) => option.row === null || option.row.slot === null || option.row.slot === view.id);
    if (serving.length === 0) {
      refusals.add('config', `${option.row?.model ?? option.provider} is served on no ${request.profile} slot`);
    }
    return serving;
  }

  private refusalOn(view: SlotView, option: Option, providerViews: readonly SlotView[]): { reason: QueueReason; text: string; ledger?: FullLedger } | null {
    const cost = option.row?.cost ?? UNTABLED_COST;
    const slotBlock = blocked(view);
    if (slotBlock !== null) {
      return { reason: view.state === 'needs-login' ? 'config' : 'capacity', text: slotBlock };
    }
    if (option.row !== null && this.deps.reservations.sessionsOf(view.id, option.row.model) >= option.row.sessions) {
      return { reason: 'capacity', text: `${view.label}: ${option.row.sessions} of ${option.row.sessions} ${option.row.model} sessions busy` };
    }
    const throttled = this.throttled(option.provider, providerViews);
    if (throttled !== null) {
      return { reason: 'capacity', text: throttled };
    }
    if (this.deps.cap.neverFits(view, cost)) {
      return { reason: 'config', text: `${option.entry.model ?? option.provider} costs ${cost}, above the cap of ${view.label} or the global cap — raise it in Settings → Models` };
    }
    const capped = this.deps.cap.refusal(view, cost);
    if (capped !== null) {
      return { reason: 'capacity', text: capped };
    }
    const full = this.deps.ledgers.fullOn(view);
    return full === null ? null : { reason: 'ledger', text: full.line, ledger: full };
  }

  private throttled(provider: WorkerProviderId, views: readonly SlotView[]): string | null {
    if (this.deps.throttle === undefined) {
      return null;
    }
    const live = views.reduce((sum, view) => sum + view.busy, 0);
    const base = views.every((view) => view.total !== null) ? views.reduce((sum, view) => sum + (view.total ?? 0), 0) : null;
    return this.deps.throttle.refusal(provider, live, base);
  }

  private grantOf(option: Option, view: SlotView, request: ClassRequest): PoolGrantDecision {
    const row = option.row;
    const model = row?.model ?? option.entry.model;
    const what = row === null ? `${model ?? 'the default model'} (not in the model table)` : `${row.model}, class ${row.class}, cost ${row.cost}`;
    const reason = `${what} on ${view.label} — ${request.why}`;
    return { kind: 'grant', slot: { id: view.id, label: view.label }, provider: option.provider, model, class: row?.class ?? null, cost: row?.cost ?? UNTABLED_COST, reason };
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
