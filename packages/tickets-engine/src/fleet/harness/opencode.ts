/**
 * The `opencode` adapter (ADR-0075): drives `opencode serve` (v2, pinned
 * against v2.0.32) bound to loopback. Progress is SUBSCRIBED (the SSE
 * `/api/event` stream: text parts while they generate, every tool call)
 * with polling as the fallback that owns the turn's end, the usage totals
 * and the waits. A worker that outlived its runner is taken back by
 * `attach`. The node seams (spawn, fetch, port pick) come through the
 * constructor; the specs run it against fakes.
 */
import { freePort, type SpawnFn } from '../procs';
import type { AttachInfo, FetchFn, NowFn, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { OpencodeCatalog } from './opencode-catalog';
import { OpencodeClient } from './opencode-client';
import { OpencodeEventStream } from './opencode-event-stream';
import { OpencodeLaunch } from './opencode-launch';
import { OpencodeMessageWalk } from './opencode-message-walk';
import { OpencodePoller } from './opencode-poller';
import { OpencodeServer } from './opencode-server';
import { OpencodeSessionSetup } from './opencode-session-setup';
import { OpencodeSseFold } from './opencode-sse-fold';
import { newOpencodeState, type OpencodeContext } from './opencode-state';
import { OpencodeUsage } from './opencode-usage';
import { OpencodeWorker } from './opencode-worker';

export class OpencodeAdapter implements ProviderAdapter {
  readonly id = 'opencode' as const;
  readonly label = 'OpenCode';
  readonly liveInject = true;
  readonly promptless = true;

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly fetchFn: FetchFn,
    private readonly pickPort: () => Promise<number>,
    private readonly now: NowFn,
  ) {}

  spawn(start: ProviderStart): WorkerHandle {
    const { worker, launch } = this.build(start, null);
    launch.boot();
    return worker;
  }

  attach(start: ProviderStart, info: AttachInfo): WorkerHandle {
    const { worker, launch } = this.build(start, info);
    launch.attach(info);
    return worker;
  }

  /** One worker's parts, wired; the kill reaches the worker through a late-bound arrow. */
  private build(start: ProviderStart, attached: AttachInfo | null): { worker: OpencodeWorker; launch: OpencodeLaunch } {
    const ctx: OpencodeContext = { start, state: newOpencodeState(start, attached), client: new OpencodeClient(this.fetchFn), now: this.now, kill: () => worker.kill() };
    const usage = new OpencodeUsage(ctx);
    const fold = new OpencodeSseFold(ctx, usage);
    const events = new OpencodeEventStream(ctx, (raw) => fold.onEvent(raw));
    const poller: OpencodePoller = new OpencodePoller(ctx, { usage, walk: new OpencodeMessageWalk(ctx, fold.sealed), attached: attached !== null, gone: () => worker.finish(null) });
    const server = new OpencodeServer(ctx, this.spawnFn);
    const catalog = new OpencodeCatalog(ctx);
    const worker: OpencodeWorker = new OpencodeWorker(ctx, { server, events, poller, catalog, attached });
    const launch = new OpencodeLaunch(ctx, { worker, server, setup: new OpencodeSessionSetup(ctx), usage, catalog, events, poller, pickPort: this.pickPort });
    return { worker, launch };
  }
}

export function opencodeAdapter(spawnFn: SpawnFn, fetchFn: FetchFn = fetch, pickPort: () => Promise<number> = freePort, now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new OpencodeAdapter(spawnFn, fetchFn, pickPort, now);
}
