import type { QuotaWindow, SlotStateName, SlotView } from '../protocol';
import type { Slot } from './slot';
import type { SurplusCalculator } from './surplus-calculator';

/** What the registry knows of a slot besides its config. */
export interface SlotFacts {
  readonly windows: readonly QuotaWindow[];
  /** The refused login, with its reason; null while the login stands. */
  readonly login: string | null;
  readonly busy: number;
  readonly lastFetch: string | null;
  readonly lastFetchError: string | null;
}

/** A window past its reset no longer holds its old numbers: it counts as full again, `estimated`, until the next read. */
export function effectiveWindow(window: QuotaWindow, now: Date): QuotaWindow {
  if (window.resetsAt === null || Date.parse(window.resetsAt) > now.getTime()) {
    return window;
  }
  const { rejected: _rejected, used: _used, ...rest } = window;
  return { ...rest, remaining: 1, resetsAt: null, reliability: 'estimated' };
}

/** The first window that is spent: none left, or the provider refused. */
function spentWindow(windows: readonly QuotaWindow[]): QuotaWindow | null {
  return windows.find((w) => w.rejected === true || (w.remaining !== null && w.remaining <= 0)) ?? null;
}

/**
 * A slot's state (req-177): `needs login` while its login is refused,
 * `exhausted` while a window is spent, `busy` while runs hold it, `unknown`
 * with no readout and no counted run, else `ready`. Pure: the registry hands
 * it the facts and the time.
 */
export class SlotStateResolver {
  constructor(private readonly surplus: SurplusCalculator) {}

  view(slot: Slot, facts: SlotFacts, now: Date): SlotView {
    const windows = facts.windows.map((w) => effectiveWindow(w, now));
    const { state, reason } = this.stateOf(windows, facts);
    return {
      id: slot.id,
      label: slot.label,
      provider: slot.provider,
      billing: slot.billing,
      quota: slot.quota,
      state,
      busy: facts.busy,
      total: slot.sessions,
      windows,
      q: this.surplus.q(windows, now),
      reason,
      lastFetch: facts.lastFetch,
      lastFetchError: facts.lastFetchError,
      implied: slot.implied,
    };
  }

  private stateOf(windows: readonly QuotaWindow[], facts: SlotFacts): { state: SlotStateName; reason: string | null } {
    if (facts.login !== null) {
      return { state: 'needs-login', reason: facts.login };
    }
    const spent = spentWindow(windows);
    if (spent !== null) {
      return { state: 'exhausted', reason: `the ${spent.name} window is spent${spent.resetsAt === null ? '' : ` until ${spent.resetsAt}`}` };
    }
    if (facts.busy > 0) {
      return { state: 'busy', reason: null };
    }
    const known = windows.some((w) => w.reliability !== 'unknown' || w.fetchedAt !== null);
    return { state: known ? 'ready' : 'unknown', reason: null };
  }
}
