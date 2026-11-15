import type { Clock } from '../ports/clock';
import { normalizeFleetPools, WORKER_PROVIDERS, type ChainConfig, type FleetPools, type RunInfo, type WorkerProviderId } from '../protocol';
import { effectivePoolSizes, isQuotaError, isRateLimitError, POOL_PROBE_INTERVAL_MS, QUOTA_PAUSE_MS, RATE_LIMIT_SHRINK_MS, type PoolShrink } from './pool-sizes';

/** No limit of its own: a provider whose slots serve unbounded sessions. */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** The pools with each provider's size taken from its slots' sessions. */
function bySessions(pools: FleetPools, sessionsOf: (provider: WorkerProviderId) => number | null): FleetPools {
  const out = { ...pools } as Record<WorkerProviderId, FleetPools[WorkerProviderId]>;
  for (const provider of WORKER_PROVIDERS) {
    out[provider] = { ...pools[provider], size: sessionsOf(provider) ?? UNBOUNDED };
  }
  return out;
}

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

  /**
   * The sizes the next dispatch pass plans with. With the capacity pool
   * (req-170) a provider's size is the sessions its slots serve
   * (`sessionsOf`, unbounded = no limit of its own); without it the
   * plugin's `fleet.pool.<provider>.size` stands (every older wiring).
   */
  sizes(config: ChainConfig | null, sessionsOf?: (provider: WorkerProviderId) => number | null): Record<WorkerProviderId, number> {
    const probed: Partial<Record<WorkerProviderId, number | null>> = {};
    for (const provider of WORKER_PROVIDERS) {
      probed[provider] = this.probed[provider]?.slots ?? null;
    }
    const configured = config?.pools ?? normalizeFleetPools(undefined);
    const pools = sessionsOf === undefined ? configured : bySessions(configured, sessionsOf);
    return effectivePoolSizes({ pools, probed, shrink: this.shrink, nowMs: this.clock.now().getTime(), pausedUntil: this.quotaPause });
  }

  /**
   * req-170's throttle for the pool: a provider paused for its quota takes
   * nothing; a rate limit's shrink or a local server's slot count lowers its
   * ceiling below the sessions its slots serve (`base`, null = unbounded).
   */
  refusal(provider: WorkerProviderId, live: number, base: number | null): string | null {
    const pausedUntil = this.quotaPause[provider];
    if (pausedUntil !== undefined && this.clock.now().getTime() < pausedUntil) {
      return `${provider} is out of quota until ${new Date(pausedUntil).toISOString()}`;
    }
    const probe = this.probed[provider]?.slots ?? null;
    const shrink = this.shrink[provider];
    const shrunk = shrink !== undefined && this.clock.now().getTime() < shrink.untilMs ? shrink.count : 0;
    const bound = probe === null ? base : base === null ? probe : Math.min(base, probe);
    if (bound === null) {
      return null;
    }
    const ceiling = Math.max(1, bound - shrunk);
    return live >= ceiling ? `${provider} runs ${live} of ${ceiling} sessions${shrunk > 0 ? ' (a rate limit shrank it)' : ''}` : null;
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
