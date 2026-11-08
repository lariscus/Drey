/**
 * The quota readout port (req-177): one implementation per provider —
 * z.ai's quota endpoint, Kimi's usages endpoint, Claude Code's rate-limit
 * events, the runner's own counting. Interfaces only.
 */
import type { QuotaWindow } from '../protocol';
import type { Slot } from './slot';

/** One read: the windows, a login the provider refused, or a readout that is not there right now. */
export type QuotaReading =
  /** `detail`: why the provider's own readout was not used (the windows are the fallback's). */
  | { readonly kind: 'windows'; readonly windows: readonly QuotaWindow[]; readonly detail?: string }
  | { readonly kind: 'login'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface QuotaSource {
  read(slot: Slot): Promise<QuotaReading>;
}

/** The answer of a quota endpoint. */
export interface HttpReply {
  readonly status: number;
  /** The parsed JSON body; null when there was none or it did not parse. */
  readonly body: unknown;
}

/** A GET over the network, as the remote sources need it (the composition root wires `fetch`). */
export interface QuotaHttp {
  getJson(url: string, headers: Readonly<Record<string, string>>): Promise<HttpReply>;
}

export const HOUR_MS = 3_600_000;
export const FIVE_HOURS_MS = 5 * HOUR_MS;
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** A month as the surplus measures it: 30 days. */
export const MONTH_MS = 30 * 24 * HOUR_MS;

/** A window's length by its name; null for a name the runner does not know. */
export function spanOf(name: string): number | null {
  if (name === '5h') {
    return FIVE_HOURS_MS;
  }
  if (name === '7d') {
    return WEEK_MS;
  }
  return name.startsWith('month') ? MONTH_MS : null;
}

/** A share clamped to 0–1, or null for anything that is not a number. */
export function shareOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/** An instant the providers write as epoch seconds, epoch ms or an ISO string, as ISO; null when unreadable. */
export function instantOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return instantOf(asNumber);
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}
