import type { WorkerProviderId } from './protocol';

// ---------------------------------------------------------------------------
// Slots (req-177, ADR-0095 later change): a slot is an account a worker runs
// on — `Claude A` and `Claude B` as two Claude Code logins, `z.ai`, `Kimi`,
// at work `Copilot` — with a billing kind and its quota windows. Req-290
// retired the profile a slot once carried: every slot may serve every
// repository. These are the wire shapes `GET /slots`, the `slot` event and
// the chain status carry; the runner's `fleet/routing/` computes them.

/** How far a window's numbers can be trusted: read from the provider, counted by the runner, or not known. */
export type QuotaReliability = 'measured' | 'estimated' | 'unknown';

/** Where a slot's quota is read: the provider's own readout, or the runner's own counting. */
export type QuotaKind = 'claude-code' | 'zai' | 'kimi' | 'counting';

/** One quota window of a slot (5 h rolling, 7 d, a month). */
export interface QuotaWindow {
  /** `5h`, `7d`, `month`, `month-code`. */
  readonly name: string;
  /** The window's length in ms (the surplus needs it); null when unknown. */
  readonly spanMs: number | null;
  /** The share left, 0–1; null when unknown. */
  readonly remaining: number | null;
  /** When the window resets (ISO); null when unknown. */
  readonly resetsAt: string | null;
  readonly reliability: QuotaReliability;
  /** When the reading was taken (ISO); null when never. */
  readonly fetchedAt: string | null;
  /** The counted amount, for a window the runner counts itself (`412 of 1,000`). */
  readonly used?: number;
  readonly limit?: number;
  readonly unit?: 'tokens' | 'runs';
  /** The provider refused further use in this window (Claude's `rejected`). */
  readonly rejected?: boolean;
}

/** What a slot costs: a monthly subscription, or credits used. Prices are display data, never billing. */
export type SlotBilling =
  | { readonly kind: 'subscription'; readonly pricePerMonth: number | null; readonly currency?: string }
  | { readonly kind: 'credits'; readonly pricePerCredit: number | null; readonly currency?: string }
  /** req-287: billed per token, the price of one million tokens. */
  | { readonly kind: 'token'; readonly pricePerMillion: number | null; readonly currency?: string };

/** A slot's state as the 7l card and the 7e chip show it. */
export type SlotStateName = 'ready' | 'busy' | 'exhausted' | 'needs-login' | 'unknown';

/** One slot as `GET /slots` reports it. */
export interface SlotView {
  readonly id: string;
  readonly label: string;
  readonly provider: WorkerProviderId;
  readonly billing: SlotBilling | null;
  readonly quota: QuotaKind;
  readonly state: SlotStateName;
  /** Live runs on the slot. */
  readonly busy: number;
  /** Concurrent sessions the slot serves (`sessions:`); null = no cap of its own. */
  readonly total: number | null;
  readonly windows: readonly QuotaWindow[];
  /** The surplus `q = R / T`, the minimum over the windows; null when no window can tell. */
  readonly q: number | null;
  /** Why the slot is exhausted or needs a login; null otherwise. */
  readonly reason: string | null;
  /** The last quota read (ISO), and its error when it failed. */
  readonly lastFetch: string | null;
  readonly lastFetchError: string | null;
  /** True for the stand-in slot of a provider `service.json` names no slot for. */
  readonly implied: boolean;
}

/** One slot as the 7e Capacity band's chip needs it (rides `GET /chain`). */
export interface SlotSummary {
  readonly id: string;
  readonly label: string;
  readonly state: SlotStateName;
  readonly busy: number;
  readonly total: number | null;
  /** The longest window's remaining share (the weekly one where there is one). */
  readonly remaining: number | null;
  readonly reliability: QuotaReliability;
  readonly q: number | null;
  /** That window's reset (ISO). */
  readonly resetsAt: string | null;
  /** req-317: what the runner counted in that window (tokens or runs); absent when the window is a provider readout or nothing was counted. */
  readonly used?: number;
  readonly unit?: 'tokens' | 'runs';
}
