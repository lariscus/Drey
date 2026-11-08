import type { Clock } from '../ports/clock';
import { normalizeFleetPools, WORKER_PROVIDERS, type ChainConfig, type FleetPools, type RunInfo, type WorkerProviderId } from '../protocol';
import { effectivePoolSizes, isQuotaError, isRateLimitError, POOL_PROBE_INTERVAL_MS, QUOTA_PAUSE_MS, RATE_LIMIT_SHRINK_MS, type PoolShrink } from './pool-sizes';

/** Asks a pool's server for its parallel slots; null when it gives no count. */
export type SlotProbe = (baseUrl: string) => Promise<number | null>;

/**
 * The provider pools' capacity right now (req-63): the probes of local
 * servers, a rate limit's shrink and a spent quota's pause. Not persisted —
 * a restart forgets a throttle on purpose.
 */
export class PoolCapacity {
  private readonly shrink: Partial<Record<WorkerProviderId, PoolShrink>> = {};
  private readonly quotaPause: Partial<Record<WorkerProviderId, number>> = {};
  private readonly probed: Partial<Record<WorkerProviderId, { slots: number | null; atMs: number; url: string }>> = {};

  constructor(
    private readonly probe: SlotProbe,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {}

  /** The sizes the next dispatch pass plans with. */
  sizes(config: ChainConfig | null): Record<WorkerProviderId, number> {
    const probed: Partial<Record<WorkerProviderId, number | null>> = {};
    for (const provider of WORKER_PROVIDERS) {
      probed[provider] = this.probed[provider]?.slots ?? null;
    }
    return effectivePoolSizes({ pools: config?.pools ?? normalizeFleetPools(undefined), probed, shrink: this.shrink, nowMs: this.clock.now().getTime(), pausedUntil: this.quotaPause });
  }

  /** The quota pauses still running, as ISO instants. */
  quotaPausedUntil(): Record<string, string> {
    const nowMs = this.clock.now().getTime();
    const out: Record<string, string> = {};
    for (const [provider, untilMs] of Object.entries(this.quotaPause)) {
      if (untilMs !== undefined && untilMs > nowMs) {
        out[provider] = new Date(untilMs).toISOString();
      }
    }
    return out;
  }

  /** A failed run's error read for the pool: a spent quota pauses the provider, a rate limit shrinks its pool. */
  noteFailure(info: RunInfo): void {
    if (info.state !== 'failed') {
      return;
    }
    const nowMs = this.clock.now().getTime();
    if (isQuotaError(info.lastError)) {
      const untilMs = nowMs + QUOTA_PAUSE_MS;
      this.quotaPause[info.provider] = untilMs;
      this.log(`${info.provider} is out of quota (${(info.lastError ?? '').slice(0, 160)}) — no new ${info.provider} run until ${new Date(untilMs).toISOString()}, then it tries again`);
    } else if (isRateLimitError(info.lastError)) {
      const active = this.shrink[info.provider];
      const count = active !== undefined && nowMs < active.untilMs ? active.count + 1 : 1;
      this.shrink[info.provider] = { count, untilMs: nowMs + RATE_LIMIT_SHRINK_MS };
      this.log(`${info.provider} hit its rate limit — its pool runs ${count} slot${count === 1 ? '' : 's'} smaller for ${RATE_LIMIT_SHRINK_MS / 60_000} minutes`);
    }
  }

  /** Asks each probed pool's server for its slots, at most every few minutes. */
  async refreshProbes(pools: FleetPools): Promise<void> {
    const nowMs = this.clock.now().getTime();
    for (const provider of WORKER_PROVIDERS) {
      const url = pools[provider].probeUrl;
      if (url === null) {
        delete this.probed[provider];
        continue;
      }
      const last = this.probed[provider];
      if (last !== undefined && last.url === url && nowMs - last.atMs < POOL_PROBE_INTERVAL_MS) {
        continue;
      }
      const slots = await this.probe(url);
      if (last?.slots !== slots || last.url !== url) {
        this.log(
          slots === null
            ? `${provider} pool probe at ${url} gave no slot count — the configured size stands`
            : `${provider} pool probe: ${url} runs ${slots} parallel slot${slots === 1 ? '' : 's'}`,
        );
      }
      this.probed[provider] = { slots, atMs: nowMs, url };
    }
  }
}
