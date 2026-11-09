import type { AcpUsageMeter, AcpUsageRecord } from './acp-harness';
import type { KimiUsageReader } from './kimi-usage';

/**
 * Kimi's usage source (E10-8): its ACP stream carries no token counts, the
 * session's wire log does — every model call a record. The meter hands out
 * the records a turn added; a resumed session's earlier records are skipped.
 */
export class KimiWireMeter implements AcpUsageMeter {
  private seen = 0;

  constructor(private readonly read: KimiUsageReader) {}

  async skipEarlier(sessionId: string): Promise<void> {
    this.seen = (await this.read(sessionId).catch(() => [] as readonly AcpUsageRecord[])).length;
  }

  async turnRecords(sessionId: string): Promise<readonly AcpUsageRecord[]> {
    const records = await this.read(sessionId).catch(() => [] as readonly AcpUsageRecord[]);
    const fresh = records.slice(this.seen);
    this.seen = Math.max(this.seen, records.length);
    return fresh;
  }
}
