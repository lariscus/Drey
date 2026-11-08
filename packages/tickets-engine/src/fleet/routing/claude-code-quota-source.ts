import type { RateLimitReading, RateLimitWindow } from '../harness/contract';
import type { FileSystem } from '../ports/file-system';
import type { QuotaWindow } from '../protocol';
import { FIVE_HOURS_MS, instantOf, shareOf, WEEK_MS, type QuotaReading, type QuotaSource } from './quota-source';
import type { Slot } from './slot';

/** The adapter's normalized window as a slot window: the share left, measured now. */
function measured(name: string, spanMs: number, raw: RateLimitWindow | null, at: string): QuotaWindow | null {
  if (raw === null) {
    return null;
  }
  const used = shareOf(raw.utilization);
  const rejected = raw.status === 'rejected';
  const remaining = rejected ? 0 : used === null ? null : 1 - used;
  return { name, spanMs, remaining, resetsAt: raw.resetsAt, reliability: 'measured', fetchedAt: at, ...(rejected ? { rejected: true } : {}) };
}

/** One window of `cachedUsageUtilization.utilization` (whole percent, unlike the event's ratios); `estimated`, the cache is not live. */
function cached(name: string, spanMs: number, raw: unknown, fetchedAt: string | null): QuotaWindow | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const percent = entry['utilization'];
  const used = typeof percent === 'number' ? shareOf(percent / 100) : null;
  const resetsAt = instantOf(entry['resets_at']);
  return used === null && resetsAt === null ? null : { name, spanMs, remaining: used === null ? null : 1 - used, resetsAt, reliability: 'estimated', fetchedAt };
}

/**
 * The `.claude.json` cache's windows (Spike 4's recorded shape:
 * `cachedUsageUtilization.{fetchedAtMs, utilization.{five_hour, seven_day}}`,
 * each `{utilization: <whole percent>, resets_at: ISO}`). The interactive
 * session writes it, headless runs do not; it is absent right after a login.
 */
export function parseClaudeCache(text: string | null): QuotaWindow[] {
  try {
    const root = (JSON.parse(text ?? 'null') as { cachedUsageUtilization?: { fetchedAtMs?: unknown; utilization?: Record<string, unknown> } } | null)?.cachedUsageUtilization;
    const windows = root?.utilization;
    if (windows === undefined || windows === null || typeof windows !== 'object') {
      return [];
    }
    const fetchedAt = instantOf(root?.fetchedAtMs);
    return [cached('5h', FIVE_HOURS_MS, windows['five_hour'], fetchedAt), cached('7d', WEEK_MS, windows['seven_day'], fetchedAt)].filter((w): w is QuotaWindow => w !== null);
  } catch {
    return [];
  }
}

/**
 * Claude Code's quota (Spike 4): every assistant turn of a headless run
 * writes a `rate_limit_event`, which the adapter normalizes; the runner's
 * slot listener hands it here per slot (`observe`). Between runs the
 * account's `.claude.json` (in its `CLAUDE_CONFIG_DIR`, else the user's
 * home) carries the CLI's last cached utilization — the fallback, marked
 * `estimated`.
 */
export class ClaudeCodeQuotaSource implements QuotaSource {
  private readonly seen = new Map<string, readonly QuotaWindow[]>();

  constructor(
    private readonly fs: FileSystem,
    /** The user's home: the default login's `.claude.json` lives there. */
    private readonly homeDir: string,
  ) {}

  /** A run of this slot reported its windows; true when they read anything. */
  observe(slotId: string, reading: RateLimitReading, at: Date): boolean {
    const stamp = at.toISOString();
    const windows = [measured('5h', FIVE_HOURS_MS, reading.fiveHour, stamp), measured('7d', WEEK_MS, reading.sevenDay, stamp)].filter((w): w is QuotaWindow => w !== null);
    if (windows.length === 0) {
      return false;
    }
    const merged = new Map((this.seen.get(slotId) ?? []).map((w) => [w.name, w]));
    for (const window of windows) {
      merged.set(window.name, window);
    }
    this.seen.set(slotId, [...merged.values()]);
    return true;
  }

  async read(slot: Slot): Promise<QuotaReading> {
    const seen = this.seen.get(slot.id);
    if (seen !== undefined) {
      return { kind: 'windows', windows: seen };
    }
    const file = this.fs.join(slot.login.claudeConfigDir ?? this.homeDir, '.claude.json');
    const windows = parseClaudeCache(await this.fs.readTextOrNull(file));
    return windows.length > 0 ? { kind: 'windows', windows } : { kind: 'unavailable', detail: 'no rate-limit event yet and no cached utilization' };
  }
}
