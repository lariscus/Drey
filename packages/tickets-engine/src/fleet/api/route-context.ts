import type * as http from 'node:http';

const MAX_BODY = 1024 * 1024;

/** One request as a route group sees it. */
export interface RouteContext {
  readonly method: string;
  readonly pathname: string;
  /** The path's segments (`/status/R-1` → `['status', 'R-1']`). */
  readonly parts: readonly string[];
  readonly search: URLSearchParams;
  /** The JSON body (`{}` when empty); throws past the limit or on broken JSON. */
  body(limit?: number): Promise<unknown>;
  respond(status: number, body: unknown): void;
  /** A non-JSON answer (the log's text, a stream's tail). */
  raw(status: number, contentType: string, text: string): void;
  /** Opens a server-sent event stream: 200, `text/event-stream`, kept open. */
  stream(): EventChannel;
}

/** An open response the route keeps writing to (server-sent events). */
export interface EventChannel {
  write(text: string): void;
  end(): void;
  /** The client went away, or the channel was ended. */
  onClose(cb: () => void): void;
}

/** One group of the runner's routes; true when it answered the request. */
export interface RouteGroup {
  handle(ctx: RouteContext): Promise<boolean>;
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      throw new Error('body too large');
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as unknown);
}

function channelOf(res: http.ServerResponse): EventChannel {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  return {
    write: (text) => {
      if (!res.writableEnded) {
        res.write(text);
      }
    },
    end: () => res.end(),
    onClose: (cb) => {
      res.on('close', cb);
    },
  };
}

export function routeContext(req: http.IncomingMessage, res: http.ServerResponse): RouteContext {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  return {
    method: req.method ?? 'GET',
    pathname: url.pathname,
    parts: url.pathname.split('/').filter((p) => p !== ''),
    search: url.searchParams,
    body: (limit = MAX_BODY) => readBody(req, limit),
    respond: (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    raw: (status, contentType, text) => {
      res.writeHead(status, { 'content-type': contentType });
      res.end(text);
    },
    stream: () => channelOf(res),
  };
}
