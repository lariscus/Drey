/**
 * Token usage over ACP (req-182). The protocol's `session/prompt` reply may
 * carry the turn's `usage` (`inputTokens` without the cache, `outputTokens`,
 * `thoughtTokens`, `cachedReadTokens`, `cachedWriteTokens`) — opencode 2.0.32
 * does, per turn; Kimi does not (its meter reads the session's wire log).
 * A harness that reports neither leaves the run's tokens unknown.
 */
import type { AcpUsageMeter, AcpUsageRecord } from './acp-harness';

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The reply's `usage` as one record; null when the reply carries none. */
export function promptUsageOf(reply: Readonly<Record<string, unknown>>): AcpUsageRecord | null {
  const usage = reply['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }
  const u = usage as Record<string, unknown>;
  return {
    model: null,
    inputOther: num(u['inputTokens']),
    output: num(u['outputTokens']) + num(u['thoughtTokens']),
    cacheRead: num(u['cachedReadTokens']),
    cacheCreation: num(u['cachedWriteTokens']),
    aggregate: true,
  };
}

/** The standard source: one record per turn, off the `session/prompt` reply. A resumed session's past is never in it. */
export class PromptUsageMeter implements AcpUsageMeter {
  async skipEarlier(): Promise<void> {}

  async turnRecords(_sessionId: string, reply: Readonly<Record<string, unknown>>): Promise<readonly AcpUsageRecord[]> {
    const record = promptUsageOf(reply);
    return record === null ? [] : [record];
  }
}
