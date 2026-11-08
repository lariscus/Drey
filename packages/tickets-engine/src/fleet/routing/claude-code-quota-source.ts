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

/** A utilization the cache may write as 0–1 or as a percentage. */
function utilizationOf(value: unknown): number | null {
  return typeof value === 'number' && value > 1 ? shareOf(value / 100) : shareOf(value);
}

/** One window of `cachedUsageUtilization`, read leniently (snake or camel case); `estimated`, the cache is not live. */
function cached(name: string, spanMs: number, raw: unknown): QuotaWindow | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const used = utilizationOf(entry['utilization']);
  const resetsAt = instantOf(entry['resetsAt'] ?? entry['resets_at']);
  return used === null && resetsAt === null ? null : { name, spanMs, remaining: used === null ? null : 1 - used, resetsAt, reliability: 'estimated', fetchedAt: null };
}

/** The `.claude.json` cache's windows; the shape was not recorded by Spike 4, so both spellings are read. */
export function parseClaudeCache(text: string | null): QuotaWindow[] {
  try {
    const root = (JSON.parse(text ?? 'null') as { cachedUsageUtilization?: Record<string, unknown> } | null)?.cachedUsageUtilization;
    if (root === undefined || root === null || typeof root !== 'object') {
      return [];
    }
    const windows = [cached('5h', FIVE_HOURS_MS, root['five_hour'] ?? root['fiveHour']), cached('7d', WEEK_MS, root['seven_day'] ?? root['sevenDay'])];
    return windows.filter((w): w is QuotaWindow => w !== null);
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
