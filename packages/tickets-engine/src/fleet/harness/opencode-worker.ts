import type { PermissionDecision, QuestionAnswers, SteerRung } from '../protocol';
import type { AttachInfo, NormalizedEvent, WorkerHandle } from './contract';
import { agentBody, INTERRUPT_WAIT_MS, modelBody, OPENCODE_API } from './opencode-api';
import type { OpencodeCatalog } from './opencode-catalog';
import type { OpencodeEventStream } from './opencode-event-stream';
import type { OpencodePoller } from './opencode-poller';
import type { OpencodeServer } from './opencode-server';
import { emitOf, ready, type OpencodeContext } from './opencode-state';

/** The parts one worker drives. */
export interface OpencodeWorkerParts {
  readonly server: OpencodeServer;
  readonly events: OpencodeEventStream;
  readonly poller: OpencodePoller;
  readonly catalog: OpencodeCatalog;
  readonly attached: AttachInfo | null;
}

/** Answers after `ms`, whatever the request does: the soft stop is a courtesy with a bound. */
function bounded<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * One OpenCode worker's handle (ADR-0075): a prompt POST queues the turn
 * (delivery `steer` while one is live — the native injection rung), a
 * `/command` runs as the command, `interrupt` is the soft stop, the owner's
 * answers go to the pending permission or form. The handle is live from the
 * start; every call reads through the shared state.
 */
export class OpencodeWorker implements WorkerHandle {
  readonly exited: Promise<number | null>;
  private resolveExit: ((code: number | null) => void) | null = null;
  private finished = false;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly parts: OpencodeWorkerParts,
  ) {
    this.emit = emitOf(ctx);
    this.exited = new Promise<number | null>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  get pid(): number | null {
    return this.parts.server.pid ?? this.parts.attached?.pid ?? null;
  }

  /** The worker is over: no more polls or events, the exit resolves once. */
  finish(code: number | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.ctx.state.alive = false;
    this.parts.poller.stop();
    this.parts.events.stop();
    this.resolveExit?.(code);
  }

  /** Kills the worker's process tree; an attached worker has no process handle here. */
  async kill(): Promise<void> {
    if (this.parts.server.started) {
      await this.parts.server.kill();
    } else if (this.parts.attached !== null) {
      await this.parts.attached.kill();
      this.finish(null);
    }
  }

  async steer(text: string): Promise<SteerRung> {
    const { state } = this.ctx;
    if (!ready(this.ctx)) {
      return 'refused';
    }
    state.lastPromptAt = this.ctx.now().getTime();
    if (state.questionHold) {
      // The owner answers the question: it is the past and must not be asked a second time.
      state.questionHold = false;
      state.lastText = '';
      this.emit({ kind: 'usage', waiting: null });
    }
    const slash = /^\/([\w.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (slash === null || !(await this.parts.catalog.postCommand(slash[1]!, (slash[2] ?? '').trim()))) {
      await this.prompt(text);
    }
    return 'inject';
  }

  /** The prompt POST: the v2 API takes the model per message (`providerID/modelID`, split at the first slash). */
  async prompt(text: string): Promise<void> {
    const { state, client, start } = this.ctx;
    if (state.sessionRef === null || !client.bound) {
      return;
    }
    try {
      const res = await client.post(OPENCODE_API.prompt(state.sessionRef), { ...modelBody(start.model, text), ...agentBody(start.permissionMode) });
      if (!res.ok) {
        this.emit({ kind: 'error', text: `prompt failed: ${res.status}` });
      }
    } catch (error) {
      if (state.alive) {
        this.emit({ kind: 'error', text: String(error).slice(0, 300) });
      }
    }
  }

  setHold(held: boolean): void {
    this.ctx.state.held = held;
    if (!held && this.ctx.state.questionHold) {
      this.ctx.state.questionHold = false; // handed back unanswered: the standing turn ends the run
      this.emit({ kind: 'usage', waiting: null });
    }
  }

  async answerPermission(requestId: string, decision: PermissionDecision): Promise<boolean> {
    if (!(await this.reply(OPENCODE_API.permissionReply(this.ctx.state.sessionRef ?? '', requestId), { decision }))) {
      return false;
    }
    if (this.ctx.state.permissionId === requestId) {
      this.ctx.state.permissionId = null;
      this.emit({ kind: 'usage', waiting: null });
    }
    return true;
  }

  async answerQuestion(formId: string, answers: QuestionAnswers): Promise<boolean> {
    if (!(await this.reply(OPENCODE_API.formReply(this.ctx.state.sessionRef ?? '', formId), { answer: answers }))) {
      return false;
    }
    if (this.ctx.state.formId === formId) {
      this.ctx.state.formId = null;
      this.emit({ kind: 'usage', waiting: null });
    }
    return true;
  }

  async interrupt(): Promise<boolean> {
    if (!ready(this.ctx)) {
      return false;
    }
    const res = await bounded(this.ctx.client.post(OPENCODE_API.interrupt(this.ctx.state.sessionRef!)), INTERRUPT_WAIT_MS).catch(() => null);
    return res !== null && res.ok;
  }

  /** The soft stop first, bounded — a server that never answers must not keep the tree-kill from running. */
  async stop(): Promise<void> {
    const { state, client } = this.ctx;
    if (state.sessionRef !== null && client.bound) {
      await bounded(client.post(OPENCODE_API.interrupt(state.sessionRef)), INTERRUPT_WAIT_MS).catch(() => undefined);
    }
    await this.kill();
  }

  private async reply(path: string, body: unknown): Promise<boolean> {
    if (!ready(this.ctx)) {
      return false;
    }
    try {
      return (await this.ctx.client.post(path, body)).ok;
    } catch {
      return false;
    }
  }
}
