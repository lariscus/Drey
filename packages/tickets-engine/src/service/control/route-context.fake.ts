import type { EventChannel, RouteContext } from '../../fleet/api/route-context';

/** A recorded answer of a fake request. */
export interface Answer {
  status: number;
  body: unknown;
  text: string | null;
}

/** An open fake event channel: what was written, whether it ended. */
export interface FakeChannel extends EventChannel {
  readonly written: string[];
  ended: boolean;
  close(): void;
}

export function fakeChannel(): FakeChannel {
  const closers: Array<() => void> = [];
  const ch: FakeChannel = {
    written: [],
    ended: false,
    write: (text) => ch.written.push(text),
    end: () => {
      ch.ended = true;
      closers.forEach((cb) => cb());
    },
    onClose: (cb) => closers.push(cb),
    close: () => closers.forEach((cb) => cb()),
  };
  return ch;
}

/** A request to a route group, recording its answer. */
export function fakeRequest(method: string, url: string, body: unknown = {}, channel: FakeChannel = fakeChannel()): { ctx: RouteContext; answer: Answer } {
  const parsed = new URL(url, 'http://127.0.0.1');
  const answer: Answer = { status: 0, body: null, text: null };
  const ctx: RouteContext = {
    method,
    pathname: parsed.pathname,
    parts: parsed.pathname.split('/').filter((p) => p !== ''),
    search: parsed.searchParams,
    body: async () => body,
    respond: (status, json) => {
      answer.status = status;
      answer.body = json;
    },
    raw: (status, _type, text) => {
      answer.status = status;
      answer.text = text;
    },
    stream: () => {
      answer.status = 200;
      return channel;
    },
  };
  return { ctx, answer };
}
