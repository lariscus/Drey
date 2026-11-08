import type { NormalizedEvent } from './contract';
import type { OpencodeCatalog } from './opencode-catalog';
import type { OpencodeEventStream } from './opencode-event-stream';
import type { OpencodePoller } from './opencode-poller';
import type { OpencodeServer } from './opencode-server';
import type { OpencodeSessionSetup } from './opencode-session-setup';
import { emitOf, type OpencodeContext } from './opencode-state';
import type { OpencodeUsage } from './opencode-usage';
import type { OpencodeWorker } from './opencode-worker';

export interface OpencodeLaunchParts {
  readonly worker: OpencodeWorker;
  readonly server: OpencodeServer;
  readonly setup: OpencodeSessionSetup;
  readonly usage: OpencodeUsage;
  readonly catalog: OpencodeCatalog;
  readonly events: OpencodeEventStream;
  readonly poller: OpencodePoller;
  readonly pickPort: () => Promise<number>;
}

/**
 * How an OpenCode worker comes up: its own server booted (port, password,
 * ready, the session verified or created, the usage base read, the
 * compact-first settled, then the subscription, the poll and the first
 * prompt), or a worker that outlived its runner taken back (its server is
 * up, its session exists — only the poll and the handle are ours again).
 */
export class OpencodeLaunch {
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly parts: OpencodeLaunchParts,
  ) {
    this.emit = emitOf(ctx);
  }

  attach(info: { readonly address: string; readonly password: string; readonly sessionRef: string; readonly runStartedMs: number }): void {
    const { state, client } = this.ctx;
    client.setAddress(info.address);
    client.setPassword(info.password);
    state.sessionRef = info.sessionRef;
    state.startedAt = info.runStartedMs;
    state.lastPromptAt = info.runStartedMs;
    this.emit({ kind: 'note', text: `re-attached to the opencode server on ${info.address}, session ${info.sessionRef}` });
    this.watch();
    void this.parts.catalog.loadCommands();
    void this.parts.catalog.reportContextWindow();
  }

  /** The boot, in the background; a failure ends the worker (and a server that came up is ours to end). */
  boot(): void {
    void this.run().catch(async (error: unknown) => {
      if (this.ctx.state.alive) {
        this.emit({ kind: 'error', text: String(error).slice(0, 400) });
      }
      this.parts.worker.finish(-1);
      await this.parts.server.kill().catch(() => undefined);
    });
  }

  private async run(): Promise<void> {
    const { state, client, start } = this.ctx;
    const { server, worker } = this.parts;
    const port = await this.parts.pickPort();
    client.setAddress(`http://127.0.0.1:${port}`);
    const password = await server.spawn(port, (code) => worker.finish(code));
    client.setPassword(password);
    if (!(await server.ready())) {
      await server.kill();
      return worker.finish(null);
    }
    if (!(await this.parts.setup.preflight())) {
      await server.kill(); // a missing session respawns the run fresh, never a failed one (T-0049)
      return worker.finish(-1);
    }
    await this.parts.setup.create();
    start.onAttachInfo?.({ address: client.base, password, pid: server.pid !== null && server.pid > 0 ? server.pid : null });
    this.emit({ kind: 'note', text: `opencode serve on 127.0.0.1:${port}, session ${state.sessionRef}` });
    await this.beforePrompt();
    this.watch();
    await this.parts.catalog.loadCommands();
    void this.parts.catalog.reportContextWindow();
    // A quiet start (req-75) posts nothing; an empty instruction is a resumed session that only stands (req-80).
    if (start.holdAtSpawn !== true && start.instruction !== '') {
      await worker.prompt(start.instruction);
    }
  }

  /**
   * Before the prompt: the resumed session's totals and messages are its past
   * only (a fresh adapter that read them again replayed old usage, req-80);
   * then the native compact, settled before `lastPromptAt` exists (T-0049).
   */
  private async beforePrompt(): Promise<void> {
    const { state, start, now } = this.ctx;
    await this.parts.usage.readBase();
    if (start.resumeRef !== null) {
      state.seenBeforeMs = now().getTime();
    }
    await this.parts.setup.compactFirst();
    state.startedAt = now().getTime();
    state.lastPromptAt = state.startedAt;
  }

  /** Live parts and tool calls from here on; the poll keeps usage and the turn's end. */
  private watch(): void {
    this.parts.events.subscribe();
    this.parts.poller.start();
  }
}
