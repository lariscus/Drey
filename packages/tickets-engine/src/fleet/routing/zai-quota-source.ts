import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { QuotaWindow } from '../protocol';
import { FIVE_HOURS_MS, HOUR_MS, instantOf, MONTH_MS, shareOf, WEEK_MS, type QuotaHttp, type QuotaReading, type QuotaSource } from './quota-source';
import type { Slot } from './slot';

export const ZAI_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';
export const ZAI_DEFAULT_AUTH_ENTRY = 'zai-coding-plan';

/**
 * z.ai's numeric window units (reconstructed, not recorded by Spike 4):
 * 3 hours, 4 days, 5 months, 6 weeks. A unit outside the table falls back
 * to the reset distance (at most five hours away: the 5 h window, else the
 * week).
 */
const NUMERIC_UNITS: Readonly<Record<number, number>> = { 3: HOUR_MS, 4: 24 * HOUR_MS, 5: MONTH_MS, 6: WEEK_MS };

const WORD_UNITS: readonly (readonly [RegExp, number])[] = [
  [/^h(our)?s?$/i, HOUR_MS],
  [/^d(ay)?s?$/i, 24 * HOUR_MS],
  [/^w(eek)?s?$/i, WEEK_MS],
  [/^mon(th)?s?$/i, MONTH_MS],
];

function unitMs(unit: unknown): number | null {
  if (typeof unit === 'number') {
    return NUMERIC_UNITS[unit] ?? null;
  }
  if (typeof unit === 'string') {
    return WORD_UNITS.find(([re]) => re.test(unit.trim()))?.[1] ?? null;
  }
  return null;
}

function nameOf(spanMs: number): string {
  if (spanMs === FIVE_HOURS_MS) {
    return '5h';
  }
  if (spanMs === WEEK_MS) {
    return '7d';
  }
  return spanMs === MONTH_MS ? 'month' : `${Math.round(spanMs / HOUR_MS)}h`;
}

/** The window's span: unit × number, else the reset distance decides between the 5 h window and the week. */
function spanOfLimit(limit: Record<string, unknown>, resetsAt: string | null, now: Date): number {
  const unit = unitMs(limit['unit']);
  const count = typeof limit['number'] === 'number' && limit['number'] > 0 ? limit['number'] : 1;
  if (unit !== null) {
    return unit * count;
  }
  const leftMs = resetsAt === null ? Infinity : Date.parse(resetsAt) - now.getTime();
  return leftMs <= FIVE_HOURS_MS ? FIVE_HOURS_MS : WEEK_MS;
}

/** The remaining share: `remaining / usage` when both are counts, else `100 − percentage`. */
function remainingOf(limit: Record<string, unknown>): number | null {
  const total = limit['usage'];
  const left = limit['remaining'];
  if (typeof total === 'number' && total > 0 && typeof left === 'number') {
    return shareOf(left / total);
  }
  const percentage = limit['percentage'];
  return typeof percentage === 'number' ? shareOf(1 - percentage / 100) : null;
}

/** `data.limits[]` as windows; a `TIME_LIMIT` entry (tool calls, not model use) is left out. */
export function parseZaiLimits(body: unknown, now: Date): QuotaWindow[] | null {
  const data = (body as { data?: { limits?: unknown } } | null)?.data;
  if (data === undefined || !Array.isArray(data.limits)) {
    return null;
  }
  const windows: QuotaWindow[] = [];
  for (const raw of data.limits as unknown[]) {
    if (raw === null || typeof raw !== 'object') {
      continue;
    }
    const limit = raw as Record<string, unknown>;
    if (typeof limit['type'] === 'string' && limit['type'] === 'TIME_LIMIT') {
      continue;
    }
    const resetsAt = instantOf(limit['nextResetTime']);
    const spanMs = spanOfLimit(limit, resetsAt, now);
    windows.push({ name: nameOf(spanMs), spanMs, remaining: remainingOf(limit), resetsAt, reliability: 'measured', fetchedAt: now.toISOString() });
  }
  return windows;
}

const refused = (status: number, body: unknown): boolean => status === 401 || status === 403 || (body as { code?: unknown } | null)?.code === 401;

export interface ZaiQuotaSourceDeps {
  readonly http: QuotaHttp;
  readonly fs: FileSystem;
  /** opencode's `auth.json`, for a slot that names none of its own. */
  readonly authFile: string;
  readonly clock: Clock;
}

/**
 * z.ai's coding plan quota (Spike 4): `GET /api/monitor/usage/quota/limit`
 * with the plan's key, read from opencode's `auth.json` entry at each fetch
 * and never kept. Answers the 5 h and the weekly window, `measured`.
 */
export class ZaiQuotaSource implements QuotaSource {
  constructor(private readonly deps: ZaiQuotaSourceDeps) {}

  async read(slot: Slot): Promise<QuotaReading> {
    const entry = slot.login.opencodeAuthEntry ?? ZAI_DEFAULT_AUTH_ENTRY;
    const key = await this.key(slot.login.opencodeAuthFile ?? this.deps.authFile, entry);
    if (key === null) {
      return { kind: 'unavailable', detail: `no key under "${entry}" in opencode's auth.json` };
    }
    // The header form is not recorded: the bearer form first, the bare key once more before a login counts as refused.
    let reply = await this.deps.http.getJson(ZAI_QUOTA_URL, { Authorization: `Bearer ${key}` });
    if (refused(reply.status, reply.body)) {
      reply = await this.deps.http.getJson(ZAI_QUOTA_URL, { Authorization: key });
    }
    if (refused(reply.status, reply.body)) {
      return { kind: 'login', detail: `z.ai refused the key of "${entry}" (${reply.status})` };
    }
    const windows = reply.status >= 200 && reply.status < 300 ? parseZaiLimits(reply.body, this.deps.clock.now()) : null;
    return windows === null ? { kind: 'unavailable', detail: `z.ai's quota endpoint answered ${reply.status} without limits` } : { kind: 'windows', windows };
  }

  private async key(file: string, entry: string): Promise<string | null> {
    const text = await this.deps.fs.readTextOrNull(file);
    try {
      const value = (JSON.parse(text ?? 'null') as Record<string, { key?: unknown }> | null)?.[entry]?.key;
      return typeof value === 'string' && value !== '' ? value : null;
    } catch {
      return null;
    }
  }
}
