/** Loopback HTTP with the bearer of an endpoint (req-165): JSON in, JSON or text out, never a throw. */
import type { ActionReply } from '../../shared/service-window/contract';
import type { Endpoint } from './service-endpoints';

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

const TIMEOUT_MS = 10_000;

export class JsonHttp {
  constructor(private readonly fetchFn: FetchFn = (url, init) => fetch(url, init)) {}

  private request(ep: Endpoint, route: string, body?: unknown): Promise<Response> {
    return this.fetchFn(`http://127.0.0.1:${ep.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${ep.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** The JSON of a GET; null on any failure. */
  async get<T>(ep: Endpoint, route: string): Promise<T | null> {
    try {
      const res = await this.request(ep, route);
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  async text(ep: Endpoint, route: string): Promise<string | null> {
    try {
      const res = await this.request(ep, route);
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  /** A POST's outcome: ok, or the error the other side named. */
  async post(ep: Endpoint, route: string, body: unknown = {}): Promise<ActionReply & { readonly json?: unknown }> {
    try {
      const res = await this.request(ep, route, body);
      const json = (await res.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
      if (res.ok && json.ok !== false) {
        return { ok: true, json };
      }
      return { ok: false, error: typeof json.error === 'string' ? json.error : `answered ${res.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
