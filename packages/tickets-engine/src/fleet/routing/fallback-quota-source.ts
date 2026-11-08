import type { QuotaReading, QuotaSource } from './quota-source';
import type { Slot } from './slot';

/**
 * A provider's readout with the runner's counting behind it (req-177): the
 * primary's windows when it has any that are known; a refused login stays
 * a refused login; otherwise the fallback's windows, with the primary's
 * reason kept for `lastFetchError`.
 */
export class FallbackQuotaSource implements QuotaSource {
  constructor(
    private readonly primary: QuotaSource,
    private readonly fallback: QuotaSource,
  ) {}

  async read(slot: Slot): Promise<QuotaReading> {
    const first = await this.primary.read(slot).catch((error: unknown): QuotaReading => ({ kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) }));
    if (first.kind === 'login' || (first.kind === 'windows' && first.windows.some((w) => w.reliability !== 'unknown'))) {
      return first;
    }
    const second = await this.fallback.read(slot);
    if (second.kind === 'windows' && first.kind === 'unavailable') {
      return { kind: 'windows', windows: second.windows, detail: first.detail };
    }
    return second.kind === 'windows' ? second : first;
  }
}
