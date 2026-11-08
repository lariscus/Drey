import type { FetchFn } from './contract';

/**
 * The OpenCode server as the adapter talks to it: the address the server
 * listens on, the BASIC credential it printed (v2: the fixed user
 * `opencode`), and one request helper. Unbound until the boot (or the
 * attach) knows the address.
 */
export class OpencodeClient {
  private address = '';
  private auth: Record<string, string> = {};

  constructor(private readonly fetchFn: FetchFn) {}

  get bound(): boolean {
    return this.address !== '';
  }

  get base(): string {
    return this.address;
  }

  setAddress(address: string): void {
    this.address = address;
  }

  setPassword(password: string): void {
    this.auth = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  }

  get(path: string, signal?: AbortSignal): Promise<Response> {
    return this.fetchFn(`${this.address}${path}`, { headers: this.auth, ...(signal !== undefined ? { signal } : {}) });
  }

  /** A POST; with a body it is JSON. */
  post(path: string, body?: unknown): Promise<Response> {
    if (body === undefined) {
      return this.fetchFn(`${this.address}${path}`, { method: 'POST', headers: this.auth });
    }
    return this.fetchFn(`${this.address}${path}`, { method: 'POST', headers: { ...this.auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** The `{data}` of a JSON answer. */
  async data<T>(res: Response): Promise<T | undefined> {
    return ((await res.json()) as { data?: T }).data;
  }
}
