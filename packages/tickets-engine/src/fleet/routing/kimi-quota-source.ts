import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { QuotaWindow } from '../protocol';
import { FIVE_HOURS_MS, instantOf, MONTH_MS, shareOf, type QuotaHttp, type QuotaReading, type QuotaSource } from './quota-source';
import type { Slot } from './slot';

export const KIMI_USAGES_URL = 'https://api.kimi.ai/coding/v1/usages';

/** The windows of the usages answer: the rolling five hours and the two monthly ratios. */
const KIMI_WINDOWS: readonly (readonly [key: string, name: string, spanMs: number])[] = [
  ['limit_5h', '5h', FIVE_HOURS_MS],
  ['limit_month_total', 'month', MONTH_MS],
  ['limit_month_code', 'month-code', MONTH_MS],
];

/** `usages.limit_5h / limit_month_total / limit_month_code` (`used_ratio`, `reset_time`) as windows. */
export function parseKimiUsages(body: unknown, now: Date): QuotaWindow[] | null {
  const root = body as { usages?: unknown; data?: { usages?: unknown } } | null;
  const usages = (root?.usages ?? root?.data?.usages) as Record<string, unknown> | undefined;
  if (usages === undefined || usages === null || typeof usages !== 'object') {
    return null;
  }
  return KIMI_WINDOWS.flatMap(([key, name, spanMs]) => {
    const window = kimiWindow(usages[key], name, spanMs, now);
    return window === null ? [] : [window];
  });
}

function kimiWindow(raw: unknown, name: string, spanMs: number, now: Date): QuotaWindow | null {
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as { used_ratio?: unknown; reset_time?: unknown };
  const used = shareOf(entry.used_ratio);
  return { name, spanMs, remaining: used === null ? null : 1 - used, resetsAt: instantOf(entry.reset_time), reliability: 'measured', fetchedAt: now.toISOString() };
}

interface KimiToken {
  readonly accessToken: string;
  /** Epoch ms; null when the file does not say. */
  readonly expiresMs: number | null;
}

function tokenOf(text: string | null): KimiToken | null {
  try {
    const parsed = JSON.parse(text ?? 'null') as { access_token?: unknown; expires_at?: unknown } | null;
    if (typeof parsed?.access_token !== 'string' || parsed.access_token === '') {
      return null;
    }
    const expires = instantOf(parsed.expires_at);
    return { accessToken: parsed.access_token, expiresMs: expires === null ? null : Date.parse(expires) };
  } catch {
    return null;
  }
}

export interface KimiQuotaSourceDeps {
  readonly http: QuotaHttp;
  readonly fs: FileSystem;
  /** `<KIMI_HOME>` for a slot that names no home of its own (`~/.kimi-code`). */
  readonly home: string;
  readonly clock: Clock;
}

/**
 * Kimi's coding quota (Spike 4): `GET /coding/v1/usages` with the CLI
 * login's access token from `<home>/credentials/*.json`. The CLI refreshes
 * that token when it runs; an expired one is skipped (no fetch, no login
 * alarm), the last windows stand until the next run refreshed it.
 */
export class KimiQuotaSource implements QuotaSource {
  constructor(private readonly deps: KimiQuotaSourceDeps) {}

  async read(slot: Slot): Promise<QuotaReading> {
    const token = tokenOf(await this.credentials(slot));
    if (token === null) {
      return { kind: 'unavailable', detail: 'no Kimi CLI login found (credentials/*.json)' };
    }
    const now = this.deps.clock.now();
    if (token.expiresMs !== null && token.expiresMs <= now.getTime()) {
      return { kind: 'unavailable', detail: "the Kimi CLI's token has expired — the CLI refreshes it on its next run" };
    }
    const reply = await this.deps.http.getJson(KIMI_USAGES_URL, { Authorization: `Bearer ${token.accessToken}` });
    if (reply.status === 401 || reply.status === 403) {
      return { kind: 'login', detail: `Kimi refused the CLI login (${reply.status})` };
    }
    const windows = reply.status >= 200 && reply.status < 300 ? parseKimiUsages(reply.body, now) : null;
    return windows === null ? { kind: 'unavailable', detail: `Kimi's usages endpoint answered ${reply.status} without usages` } : { kind: 'windows', windows };
  }

  /** The slot's credentials file, else the first one of its home. */
  private async credentials(slot: Slot): Promise<string | null> {
    if (slot.login.kimiCredentials !== undefined) {
      return this.deps.fs.readTextOrNull(slot.login.kimiCredentials);
    }
    const dir = this.deps.fs.join(slot.login.kimiHome ?? this.deps.home, 'credentials');
    const first = (await this.deps.fs.list(dir)).filter((name) => name.endsWith('.json')).sort()[0];
    return first === undefined ? null : this.deps.fs.readTextOrNull(this.deps.fs.join(dir, first));
  }
}
