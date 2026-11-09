/**
 * The window's live feed (req-165/166): the Crew runner's `GET /events`
 * (a run's record, each stream line, slot and pool changes) and the
 * service's `GET /log/stream`, both re-opened every few seconds while they
 * are down — the runner sleeps and wakes, the service restarts on new
 * ports. Each event goes to the listener in the contract's shape.
 */
import type { ServiceWindowEvent, StreamEvent } from '../../shared/service-window/contract';
import type { FetchFn } from './json-http';
import type { Endpoint, ServiceEndpoints } from './service-endpoints';
import { logLineOf, sessionRunOf } from './snapshot-map';
import { SseParser, type SseEvent } from './sse-parser';

const RETRY_MS = 3_000;

type Listener = (event: ServiceWindowEvent) => void;

/** One server-sent event as the window's event; null for what the window does not draw. */
export function windowEventOf(source: 'runner' | 'log', sse: SseEvent): ServiceWindowEvent | null {
  try {
    const data = JSON.parse(sse.data) as unknown;
    if (source === 'log') {
      const line = typeof data === 'string' ? logLineOf(data) : null;
      return line === null ? null : { kind: 'log', line };
    }
    if (sse.event === 'run') {
      return { kind: 'run', run: sessionRunOf(data as Record<string, unknown>) };
    }
    if (sse.event === 'line') {
      const { runId, event } = data as { runId?: unknown; event?: StreamEvent };
      return typeof runId === 'string' && event !== undefined ? { kind: 'line', runId, event } : null;
    }
    return sse.event === 'slot' || sse.event === 'pool' || sse.event === 'governor' ? { kind: 'status' } : null;
  } catch {
    return null;
  }
}

export class EventRelay {
  private running = false;
  private readonly aborts = new Set<AbortController>();

  constructor(
    private readonly endpoints: ServiceEndpoints,
    private readonly listener: Listener,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.loop('runner');
    void this.loop('log');
  }

  stop(): void {
    this.running = false;
    for (const abort of this.aborts) {
      abort.abort();
    }
    this.aborts.clear();
  }

  private async loop(source: 'runner' | 'log'): Promise<void> {
    while (this.running) {
      const set = await this.endpoints.read();
      const ep = source === 'runner' ? (set?.runner ?? null) : (set?.control ?? null);
      if (ep !== null) {
        await this.follow(source, ep).catch(() => undefined);
        this.listener({ kind: 'status' });
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }

  private async follow(source: 'runner' | 'log', ep: Endpoint): Promise<void> {
    const abort = new AbortController();
    this.aborts.add(abort);
    try {
      const res = await this.fetchFn(`http://127.0.0.1:${ep.port}${source === 'runner' ? '/events' : '/log/stream'}`, {
        headers: { Authorization: `Bearer ${ep.token}` },
        signal: abort.signal,
      });
      if (!res.ok || res.body === null) {
        return;
      }
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      for (let chunk = await reader.read(); !chunk.done && this.running; chunk = await reader.read()) {
        for (const sse of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          const event = windowEventOf(source, sse);
          if (event !== null) {
            this.listener(event);
          }
        }
      }
    } finally {
      this.aborts.delete(abort);
    }
  }
}
