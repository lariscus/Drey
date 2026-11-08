import { LineBuffer } from './line-buffer';
import { EVENT_RETRY_MS, OPENCODE_API } from './opencode-api';
import type { OpencodeContext } from './opencode-state';

/**
 * The subscription to `/api/event` (SSE, BASIC auth, T-0051): each `data:`
 * line goes to the fold. A dropped or refused stream is noise — the poll
 * still covers everything — and is retried after `EVENT_RETRY_MS` until the
 * run ends.
 */
export class OpencodeEventStream {
  private abort: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly onData: (raw: string) => void,
  ) {}

  subscribe(): void {
    if (this.abort !== null || !this.ctx.state.alive || !this.ctx.client.bound) {
      return;
    }
    const controller = new AbortController();
    this.abort = controller;
    void this.read(controller).then(() => {
      if (controller.signal.aborted || !this.ctx.state.alive) {
        return;
      }
      this.abort = null;
      this.retry = setTimeout(() => this.subscribe(), EVENT_RETRY_MS);
    });
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
  }

  private async read(controller: AbortController): Promise<void> {
    try {
      const res = await this.ctx.client.get(OPENCODE_API.event, controller.signal);
      if (!res.ok || res.body === null) {
        throw new Error(`event stream answered ${res.status}`);
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      const lines = new LineBuffer();
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        for (const line of lines.feed(decoder.decode(next.value, { stream: true }))) {
          if (line.startsWith('data:')) {
            this.onData(line.slice(5).trim());
          }
        }
      }
    } catch {
      // aborted with the run, or the stream dropped — retried by the caller
    }
  }
}
