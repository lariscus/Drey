import type { RunnerEvent } from '../ports/event-sink';
import type { EventHub } from './event-hub';
import type { EventChannel, RouteContext, RouteGroup } from './route-context';

/** A comment line every this often keeps proxies and the client's idle timers from closing a quiet stream. */
export const HEARTBEAT_MS = 15_000;

/** One event as a server-sent event: its kind names it, the data is the event as JSON. */
export function sseFrame(event: RunnerEvent): string {
  const data = event.kind === 'run' ? event.info : event.kind === 'slot' ? event.slot : { runId: event.runId, event: event.event };
  return `event: ${event.kind}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * `GET /events` (req-176 step 5): the runner's events as server-sent
 * events — `run` with a run's record each time it is persisted, `line` with
 * each line of a run's stream, `slot` with a slot's view when it changed
 * (req-177) — instead of polling `/status` and tailing
 * stream files. Bearer-authenticated like every route; a read, so it never
 * keeps the runner awake. Every stream closes when the runner goes.
 */
export class EventStream implements RouteGroup {
  private readonly open = new Set<EventChannel>();

  constructor(
    private readonly hub: EventHub,
    private readonly heartbeatMs: number = HEARTBEAT_MS,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'GET' || ctx.pathname !== '/events') {
      return false;
    }
    const channel = ctx.stream();
    this.open.add(channel);
    channel.write('retry: 3000\n\n');
    const unsubscribe = this.hub.subscribe((event) => channel.write(sseFrame(event)));
    const beat = setInterval(() => channel.write(': ping\n\n'), this.heartbeatMs);
    beat.unref();
    channel.onClose(() => {
      clearInterval(beat);
      unsubscribe();
      this.open.delete(channel);
    });
    return true;
  }

  /** The runner goes: every stream ends (a server close would otherwise wait for them). */
  closeAll(): void {
    for (const channel of [...this.open]) {
      channel.end();
    }
  }
}
