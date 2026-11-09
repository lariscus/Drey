import { once } from 'node:events';
import * as http from 'node:http';
import type { ChangeHub } from './drey-port';
import type { DreyPresence } from './drey-presence';
import { readBody, timingSafeEqualStr } from './http-body';
import type { InvokeTable } from './invoke-table';

export interface InvokeServerDeps {
  /** The local bearer token every call carries. */
  readonly token: string;
  /** The hosted vault, for the health reply. */
  readonly vaultPath: string;
  readonly table: InvokeTable;
  readonly hub: ChangeHub;
  readonly presence: DreyPresence;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

const BODY_CAP = 1_000_000;
const KEEP_ALIVE_MS = 25_000;

/**
 * The invoke listener: loopback + local bearer only, independent of the
 * gateway's pairing state — the plugin's channel must survive remote off.
 * `POST /api/invoke` calls one table method, `GET /api/events` is the live
 * channel (the hub's changes plus the paths channel), `GET /api/health`.
 */
export class InvokeServer {
  private readonly server: http.Server;

  constructor(private readonly deps: InvokeServerDeps) {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        deps.log(`invoke: ${error instanceof Error ? error.message : String(error)}`, 'error');
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ ok: false, error: 'internal error' }));
      });
    });
  }

  /** Listens on loopback; resolves with the URL the plugin calls. */
  async listen(port: number): Promise<string> {
    this.server.listen(port, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the invoke listener did not bind');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    this.server.close();
    // A Drey's event stream never ends by itself: without this the service's Stop waits for it for ever.
    this.server.closeAllConnections();
    await once(this.server, 'close').catch(() => undefined);
  }

  private authorized(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${this.deps.token}`;
    return auth.length === expected.length && timingSafeEqualStr(auth, expected);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      send(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://engine.invalid');
    if (req.method === 'GET' && url.pathname === '/api/events') {
      this.events(req, res);
    } else if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, vault: this.deps.vaultPath });
    } else if (req.method === 'POST' && url.pathname === '/api/invoke') {
      await this.invoke(req, res);
    } else {
      send(res, 404, { ok: false, error: 'not found' });
    }
  }

  /**
   * The plugin's live-update channel: the same hub the gateway's SSE uses,
   * bearer-only. Events: board | fleet | remote | chat (chat carries the
   * { file, event } stream payload) and `paths` (the files the engine, or a
   * worker through the service, wrote).
   */
  private events(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { hub, presence } = this.deps;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`: connected\n\n`);
    const detach = presence.attach();
    const unsubscribe = hub.subscribe((what, payload) => {
      res.write(`data: ${JSON.stringify(payload === undefined ? { change: what } : { change: what, ...payload })}\n\n`);
    });
    const unsubscribePaths = hub.subscribePaths((change) => {
      res.write(`data: ${JSON.stringify({ change: 'paths', ...change })}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), KEEP_ALIVE_MS);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      unsubscribePaths();
      detach();
    });
  }

  private async invoke(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = await readBody(req, BODY_CAP);
    let message: { method?: unknown; payload?: unknown };
    try {
      message = JSON.parse(raw) as { method?: unknown; payload?: unknown };
    } catch {
      send(res, 400, { ok: false, error: 'the body is not JSON' });
      return;
    }
    const { table } = this.deps;
    if (typeof message.method !== 'string' || !table.has(message.method)) {
      send(res, 404, { ok: false, error: `no such method: ${String(message.method)}` });
      return;
    }
    try {
      const value = await table.call(message.method, message.payload);
      send(res, 200, { ok: true, value: value === undefined ? null : value });
    } catch (error) {
      send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
