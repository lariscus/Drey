import { WORKER_PROVIDERS, type FleetPools, type WorkerProviderId } from '../protocol';

/** A rate-limited provider's pool runs one slot smaller for this long. */
export const RATE_LIMIT_SHRINK_MS = 5 * 60_000;
/** How long a pool probe's answer holds before the next pass asks again. */
export const POOL_PROBE_INTERVAL_MS = 5 * 60_000;
/** A provider out of quota takes no new run for this long, then tries again. */
export const QUOTA_PAUSE_MS = 30 * 60_000;

/** True when a worker's error reads as the provider's usage quota being spent. */
export function isQuotaError(text: string | null | undefined): boolean {
  return text !== null && text !== undefined && /provider.quota|usage limit|quota exceeded|insufficient[ _]quota/i.test(text);
}

/** True when a worker's error reads as the provider's rate limit (429). */
export function isRateLimitError(text: string | null | undefined): boolean {
  return text !== null && text !== undefined && /\b429\b|rate[ _-]?limit|too many requests/i.test(text);
}

/** A rate limit's temporary shrink of one provider's pool. */
export interface PoolShrink {
  readonly count: number;
  readonly untilMs: number;
}

/** What the pools look like right now. */
export interface PoolReading {
  readonly pools: FleetPools;
  readonly probed: Readonly<Partial<Record<WorkerProviderId, number | null>>>;
  readonly shrink: Readonly<Partial<Record<WorkerProviderId, PoolShrink>>>;
  readonly nowMs: number;
  readonly pausedUntil?: Readonly<Partial<Record<WorkerProviderId, number>>>;
}

/**
 * The pools' effective sizes (req-63): the configured size, capped by a
 * probe's `total_slots`, minus an active rate-limit shrink — never below
 * one, so a throttled provider still moves. A provider paused for its
 * quota has none until the pause ends.
 */
export function effectivePoolSizes(reading: PoolReading): Record<WorkerProviderId, number> {
  const { pools, probed, shrink, nowMs } = reading;
  const pausedUntil = reading.pausedUntil ?? {};
  const sizes: Record<WorkerProviderId, number> = { opencode: 1, 'claude-code': 1, kimi: 1 };
  for (const provider of WORKER_PROVIDERS) {
    let size = pools[provider].size;
    const slots = probed[provider] ?? null;
    if (slots !== null && slots >= 1) {
      size = Math.min(size, slots);
    }
    const active = shrink[provider];
    if (active !== undefined && nowMs < active.untilMs) {
      size -= active.count;
    }
    sizes[provider] = nowMs < (pausedUntil[provider] ?? 0) ? 0 : Math.max(1, size);
  }
  return sizes;
}

/** Asks a llama.cpp server how many parallel slots it runs (`/props`). */
export async function fetchTotalSlots(baseUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/props`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { total_slots?: unknown };
    return typeof body.total_slots === 'number' && Number.isInteger(body.total_slots) && body.total_slots >= 1 ? body.total_slots : null;
  } catch {
    return null;
  }
}
