/**
 * The capacity pool as the chain's dispatch asks it (req-170): the
 * consumer's interfaces — `fleet/routing`'s `PoolGrant` and `RequestQueue`
 * satisfy them, a spec passes its own. Without a pool the dispatch runs as
 * before the pool (a persona's default model, the provider pools' sizes).
 */
import type { CapabilityClass, ClassRequest, PoolDecision, PoolEntry, PoolLoad, QueueEntry, WorkerProviderId } from '../protocol';

export interface ClassPool {
  choose(request: ClassRequest): PoolDecision;
  classOf(entry: PoolEntry): CapabilityClass | null;
}

export interface WaitQueue {
  begin(): void;
  wait(entry: Omit<QueueEntry, 'position' | 'since'>): void;
  end(): void;
  clear(): void;
  list(): readonly QueueEntry[];
}

export interface DispatchPool {
  readonly classes: ClassPool;
  readonly queue: WaitQueue;
  /** The live load per slot and in all (the chain status's "Now: 2.4 of 6"). */
  load(): PoolLoad;
  /** The sessions a provider's slots serve in all — the dispatch plan's bound per provider; null = unbounded. */
  sessionsOf(provider: WorkerProviderId): number | null;
}
