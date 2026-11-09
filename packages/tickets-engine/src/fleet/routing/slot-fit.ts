import type { ClassRequest, SlotView, WorkerProviderId } from '../protocol';
import type { CapabilityFilter } from './capability-filter';
import type { CapacityCap } from './capacity-cap';
import type { Ledgers } from './ledgers';
import { UNTABLED_COST } from './model-table';
import type { ReserveGuard } from './reserve-guard';
import type { RouteOption, SlotRefusal } from './route-candidate';
import type { SlotReservations } from './slot-reservations';

/**
 * A provider's own throttle (req-63's rule stands): a spent quota pauses it,
 * a rate limit or a local server's slot count lowers its ceiling. `base` is
 * the sessions its slots serve in all (null = unbounded).
 */
export interface ProviderThrottle {
  refusal(provider: WorkerProviderId, live: number, base: number | null): string | null;
}

export interface SlotFitDeps {
  readonly cap: CapacityCap;
  readonly reservations: SlotReservations;
  readonly ledgers: Ledgers;
  readonly capabilities: CapabilityFilter;
  readonly reserve: ReserveGuard;
  readonly throttle?: ProviderThrottle;
}

function blocked(view: SlotView): SlotRefusal | null {
  if (view.state === 'needs-login') {
    return { reason: 'config', text: `${view.label} needs a login (${view.reason ?? 'refused'})`, short: 'needs a login' };
  }
  if (view.state === 'exhausted') {
    return { reason: 'capacity', text: `${view.label}: ${view.reason ?? 'quota spent'}`, short: 'quota spent' };
  }
  return view.total !== null && view.busy >= view.total ? { reason: 'capacity', text: `${view.label}: ${view.busy} of ${view.total} sessions busy`, short: `${view.busy} of ${view.total} busy` } : null;
}

/**
 * The routing's hard filter on one slot (req-178 over req-170's checks):
 * the step's required capabilities, the slot's state, the row's sessions,
 * the provider's throttle, the caps, the slot's ledger and the reserve per
 * window. The first refusal wins; the profile and the row's own slot are
 * settled before (`PoolGrant`), the choice among what passes after.
 */
export class SlotFit {
  constructor(private readonly deps: SlotFitDeps) {}

  /** Why the option cannot run on this slot now; null when it can. */
  refusal(option: RouteOption, view: SlotView, request: ClassRequest, providerViews: readonly SlotView[]): SlotRefusal | null {
    const what = option.row?.model ?? option.entry.model ?? option.provider;
    const capability = this.deps.capabilities.refusal(option.row, request.needs ?? null, request.contextTokens);
    if (capability !== null) {
      return { reason: 'config', text: `${what} on ${view.label}: ${capability}`, short: capability };
    }
    return blocked(view) ?? this.room(option, view, providerViews) ?? this.spend(view, request);
  }

  /** The row's sessions, the provider's throttle and the caps. */
  private room(option: RouteOption, view: SlotView, providerViews: readonly SlotView[]): SlotRefusal | null {
    const row = option.row;
    if (row !== null && this.deps.reservations.sessionsOf(view.id, row.model) >= row.sessions) {
      return { reason: 'capacity', text: `${view.label}: ${row.sessions} of ${row.sessions} ${row.model} sessions busy`, short: `${row.model} ${row.sessions} of ${row.sessions} busy` };
    }
    const throttled = this.throttled(option.provider, providerViews);
    if (throttled !== null) {
      return { reason: 'capacity', text: throttled, short: 'provider throttled' };
    }
    const cost = row?.cost ?? UNTABLED_COST;
    if (this.deps.cap.neverFits(view, cost)) {
      return { reason: 'config', text: `${option.entry.model ?? option.provider} costs ${cost}, above the cap of ${view.label} or the global cap — raise it in Settings → Models`, short: 'above the cap' };
    }
    const capped = this.deps.cap.refusal(view, cost);
    return capped === null ? null : { reason: 'capacity', text: capped, short: 'cap full' };
  }

  /** The slot's ledger and the reserve per window. */
  private spend(view: SlotView, request: ClassRequest): SlotRefusal | null {
    const full = this.deps.ledgers.fullOn(view);
    if (full !== null) {
      return { reason: 'ledger', text: full.line, short: 'ledger full', ledger: full };
    }
    const reserve = this.deps.reserve.refusal(view, { ticket: request.ticket, persona: request.persona });
    return reserve === null ? null : { reason: 'capacity', text: reserve, short: 'reserve' };
  }

  private throttled(provider: WorkerProviderId, views: readonly SlotView[]): string | null {
    if (this.deps.throttle === undefined) {
      return null;
    }
    const live = views.reduce((sum, view) => sum + view.busy, 0);
    const base = views.every((view) => view.total !== null) ? views.reduce((sum, view) => sum + (view.total ?? 0), 0) : null;
    return this.deps.throttle.refusal(provider, live, base);
  }
}
