import type { FetchFn } from './contract';
import { OPENCODE_API } from './opencode-api';

/**
 * The opencode adapter's spec seams: a scripted `opencode serve` HTTP
 * surface (v2 shapes) and a scripted SSE channel for `/api/event`.
 */

/** A finished assistant message as v2 writes it (flat, ms epoch times). */
export const assistant = (now: number): unknown => ({
  id: 'msg_a',
  type: 'assistant',
  time: { created: now + 1, completed: now + 2 },
  content: [
    { type: 'reasoning', text: 'thinking' },
    { type: 'text', text: 'Done.' },
  ],
  tokens: { input: 8, output: 5 },
  cost: 0.01,
});

export interface ScriptedFetchOptions {
  sessionCreated: (body: unknown) => void;
  prompts: string[];
  interrupts: string[];
  /** Messages newest-first, as the API lists them. */
  messages: () => unknown[];
  usage?: { tokens: { input: number; cache?: { read?: number }; output: number }; cost: number };
  /** Pending permission requests (req-64). */
  permissions?: () => unknown[];
  /** Recorded permission replies: [requestId, body]. */
  replies?: Array<[string, unknown]>;
  /** Pending question forms (OpenCode's `question` tool). */
  forms?: () => unknown[];
  /** Recorded form replies: [formId, body]. */
  formReplies?: Array<[string, unknown]>;
  /** The `/api/event` SSE response; default: a bodyless 200 the adapter must survive. */
  eventStream?: () => Response;
}

const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const noContent = (): Response => ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response;

/** A scripted fetch: /api/info fails once, then everything answers. */
export function scriptedFetch(opts: ScriptedFetchOptions): { fetch: FetchFn; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let infoChecks = 0;
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(OPENCODE_API.info)) {
      infoChecks += 1;
      return (infoChecks < 2
        ? { ok: false, status: 503 }
        : json({ version: '2.0.32' })) as Response;
    }
    if (url.endsWith(OPENCODE_API.event)) {
      return opts.eventStream !== undefined ? opts.eventStream() : json({});
    }
    if (url.endsWith(OPENCODE_API.createSession) && init?.method === 'POST') {
      opts.sessionCreated(JSON.parse(String(init.body)));
      return json({ data: { id: 'ses_oc' } });
    }
    if (url.endsWith(OPENCODE_API.prompt('ses_oc'))) {
      opts.prompts.push(String(init?.body));
      return json({ data: { id: 'msg_q', type: 'user', delivery: 'steer' } });
    }
    if (url.endsWith(OPENCODE_API.permissions('ses_oc'))) {
      return json({ data: opts.permissions?.() ?? [] });
    }
    if (url.endsWith(OPENCODE_API.forms('ses_oc'))) {
      return json({ data: opts.forms?.() ?? [] });
    }
    const formReply = /\/form\/([^/]+)\/reply$/.exec(url);
    if (formReply !== null && init?.method === 'POST') {
      opts.formReplies?.push([decodeURIComponent(formReply[1]!), JSON.parse(String(init.body))]);
      return noContent();
    }
    const reply = /\/permission\/([^/]+)\/reply$/.exec(url);
    if (reply !== null && init?.method === 'POST') {
      opts.replies?.push([decodeURIComponent(reply[1]!), JSON.parse(String(init.body))]);
      return noContent();
    }
    if (url.endsWith(OPENCODE_API.messages('ses_oc'))) {
      return json({ data: opts.messages(), cursor: { previous: null, next: null } });
    }
    if (url.endsWith(OPENCODE_API.session('ses_oc'))) {
      return json({ data: { tokens: opts.usage?.tokens ?? { input: 10, cache: { read: 4 }, output: 5 }, cost: opts.usage?.cost ?? 0.02 } });
    }
    if (url.endsWith(OPENCODE_API.interrupt('ses_oc'))) {
      opts.interrupts.push(url);
      return json({ interrupted: false });
    }
    return json({});
  };
  return { fetch, calls };
}

/** A scripted SSE channel: the spec pushes `{type, data}` objects as `data:` lines. */
export function sseChannel(): { response: Response; push: (event: unknown) => void; end: () => void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  const encoder = new TextEncoder();
  return {
    response: { ok: true, status: 200, body: stream } as unknown as Response,
    push: (event) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`)),
    end: () => controller?.close(),
  };
}

/** One server event of this run's session. */
export const ev = (type: string, data: object): unknown => ({ type, data: { sessionID: 'ses_oc', ...data } });
