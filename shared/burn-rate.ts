/**
 * The burn rate's hold on every client (req-181): the tolerant reading of
 * the chain status's `hold`, the Autopilot popover's and status item's line,
 * and the one Needs-you card model the desktop Mission Control card and the
 * phone / iPad card both draw (board 10u's chrome, the quota stop's layout)
 * — so every device says the same words from the catalog. The engine half is
 * `packages/tickets-engine/src/fleet/routing/burn-rate-*.ts`.
 */
import type { MessageKey } from './i18n';

export type BurnRateBasisView = 'measured' | 'estimated' | 'mixed';

/** The chain status's `hold` (`BurnRateHold`), as a client reads it. */
export interface BurnRateHoldView {
  /** Today's share of the weekly quota over all slots, 0–1. */
  readonly spent: number;
  /** `routing.burnRate`, 0–1. */
  readonly limit: number;
  /** When nothing holds any more (ISO, the next UTC midnight). */
  readonly resumesAt: string;
  readonly basis: BurnRateBasisView;
  /** When the hold rose (ISO); null from a runner that does not say. */
  readonly since: string | null;
}

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === 'object' && value !== null ? (value as Rec) : null);
const share = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const BASES: readonly BurnRateBasisView[] = ['measured', 'estimated', 'mixed'];

/** The hold off a chain block (`ChainStatus.hold`); null when nothing holds (or an older runner). */
export function burnRateHoldOf(chain: unknown): BurnRateHoldView | null {
  const raw = rec(rec(chain)?.['hold']);
  const spent = share(raw?.['spent']);
  const limit = share(raw?.['limit']);
  const resumesAt = raw?.['resumesAt'];
  if (raw === null || raw['reason'] !== 'burn-rate' || spent === null || limit === null || typeof resumesAt !== 'string' || Number.isNaN(Date.parse(resumesAt))) {
    return null;
  }
  const since = raw['since'];
  return {
    spent,
    limit,
    resumesAt,
    basis: BASES.find((basis) => basis === raw['basis']) ?? 'measured',
    since: typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? since : null,
  };
}

/** The catalog's lookup and the locale's time of day. */
export interface BurnRateFormat {
  readonly t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** `00:00` in the reader's locale and zone. */
  readonly time: (date: Date) => string;
}

const percent = (value: number): number => Math.round(value * 100);

/** `Burn rate reached · resumes at 00:00` — the popover's On / Paused line. */
export function burnRateLineOf(view: BurnRateHoldView, f: BurnRateFormat): string {
  return f.t('autopilot.hold.burn_rate', { time: f.time(new Date(view.resumesAt)) });
}

export type BurnRateCardActionId = 'wait' | 'allow_once';

/** The Lead's card of a reached burn rate (board 10u's chrome, laid out like part 4, the quota stop). */
export interface BurnRateCard {
  /** Stable per day: `burn-rate-<resumesAt>` — Wait dismisses this one, tomorrow's is new. */
  readonly id: string;
  readonly tone: 'attention';
  readonly title: string;
  readonly body: string;
  /** `spent 21 %`, `resumes 00:00`, and `estimated` when the figure was not read off every slot. */
  readonly chips: readonly string[];
  /** When the hold rose (the card's meta line); null when the runner did not say. */
  readonly at: string | null;
  readonly actions: readonly { readonly id: BurnRateCardActionId; readonly label: string; readonly primary: boolean }[];
}

/** The id prefix of the card: its buttons are the plugin's, not the engine chat's. */
export const BURN_RATE_CARD_PREFIX = 'burn-rate-';

export function burnRateCardOf(view: BurnRateHoldView, f: BurnRateFormat): BurnRateCard {
  const time = f.time(new Date(view.resumesAt));
  const chips = [f.t('autopilot.hold.burn_rate.spent', { spent: percent(view.spent) }), f.t('autopilot.hold.burn_rate.resumes', { time })];
  return {
    id: `${BURN_RATE_CARD_PREFIX}${view.resumesAt}`,
    tone: 'attention',
    title: f.t('autopilot.hold.burn_rate.title', { limit: percent(view.limit) }),
    body: f.t('autopilot.hold.burn_rate.body', { time }),
    chips: view.basis === 'measured' ? chips : [...chips, f.t(`autopilot.hold.burn_rate.${view.basis}`)],
    at: view.since,
    actions: [
      { id: 'wait', label: f.t('autopilot.hold.burn_rate.wait'), primary: true },
      { id: 'allow_once', label: f.t('autopilot.hold.burn_rate.allow_once'), primary: false },
    ],
  };
}
