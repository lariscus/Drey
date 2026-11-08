import type { HttpReply, QuotaHttp } from './routing/quota-source';

/** A quota endpoint that does not answer within this is unavailable for this round. */
const QUOTA_TIMEOUT_MS = 15_000;

/** The remote quota sources' GET over the global `fetch` (req-177): bounded, never throws for an HTTP status. */
export class FetchQuotaHttp implements QuotaHttp {
  async getJson(url: string, headers: Readonly<Record<string, string>>): Promise<HttpReply> {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS) });
    const text = await res.text();
    try {
      return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
    } catch {
      return { status: res.status, body: null };
    }
  }
}
