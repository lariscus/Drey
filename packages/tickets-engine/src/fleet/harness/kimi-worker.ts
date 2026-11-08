import type { PermissionDecision, QuestionAnswers, SteerRung } from '../protocol';
import type { RunnerProcess } from '../procs';
import type { NormalizedEvent, WorkerHandle } from './contract';
import type { KimiRequests } from './kimi-requests';
import { kimiEmit, kimiText, type KimiContext } from './kimi-state';
import type { KimiTurns } from './kimi-turns';

/** How long a replayed history may keep streaming before the updates count again. */
const REPLAY_SETTLE_MS = 300;

/**
 * One Kimi worker's handle (E10-8): the ACP session set up (initialize,
 * `session/load` to resume or `session/new`, the mode, the model,
 * compact-first), then the brief as the first turn. A steer while a turn
 * runs cancels it (`session/cancel`) and rides next; the owner's interrupt
 * is the same cancel — the session stays for the owner (ADR-0096).
 */
export class KimiWorker implements WorkerHandle {
  readonly exited: Promise<number | null>;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: KimiContext,
    private readonly proc: RunnerProcess,
    private readonly parts: { readonly turns: KimiTurns; readonly requests: KimiRequests },
  ) {
    this.emit = kimiEmit(ctx);
    // Registered before `exited`: a resume that never got a session is reported first.
    proc.onExit((code) => {
      if (!ctx.state.initDone && ctx.start.resumeRef !== null) {
        ctx.start.onResumeFailed?.(`kimi exited (${code ?? 'signal'}) before the session was established`);
      }
    });
    this.exited = new Promise<number | null>((resolve) => proc.onExit(resolve));
  }

  get pid(): number | null {
    return this.proc.pid;
  }

  /** The session's setup and the first turn, in the background; a failure ends the worker. */
  begin(): void {
    void this.setUp().catch((error: unknown) => {
      this.emit({ kind: 'error', text: `kimi: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` });
      this.emit({ kind: 'usage', turn: 'idle' });
      this.ctx.finish();
    });
  }

  async steer(text: string): Promise<SteerRung> {
    const { state, acp } = this.ctx;
    if (state.ended || state.sessionId === null) {
      return 'refused';
    }
    if (this.parts.requests.open) {
      this.parts.requests.declineFor(text);
    } else if (state.busy) {
      state.steerAfterCancel = text;
      acp.notify('session/cancel', { sessionId: state.sessionId });
    } else {
      if (state.questionHold) {
        state.questionHold = false;
        this.emit({ kind: 'usage', waiting: null });
      }
      void this.parts.turns.run(text).then((outcome) => this.parts.turns.settle(outcome));
    }
    return 'inject';
  }

  setHold(held: boolean): void {
    const state = this.ctx.state;
    state.held = held;
    if (held || state.busy || this.parts.requests.open) {
      return;
    }
    if (state.questionHold) {
      state.questionHold = false;
      this.emit({ kind: 'usage', waiting: null });
    }
    if (state.initDone) {
      this.ctx.finish();
    }
  }

  /** The soft stop of the running turn over ACP `session/cancel`; the session stays. */
  async interrupt(): Promise<boolean> {
    const state = this.ctx.state;
    if (state.ended || !state.busy || state.sessionId === null) {
      return false;
    }
    this.ctx.acp.notify('session/cancel', { sessionId: state.sessionId });
    return true;
  }

  async answerPermission(requestId: string, decision: PermissionDecision): Promise<boolean> {
    return this.parts.requests.answerPermission(requestId, decision);
  }

  async answerQuestion(formId: string, answers: QuestionAnswers): Promise<boolean> {
    return this.parts.requests.answerQuestion(formId, answers);
  }

  async stop(): Promise<void> {
    this.ctx.state.ended = true;
    this.proc.endInput();
    await this.proc.killTree();
  }

  private async setUp(): Promise<void> {
    const { state, acp, start } = this.ctx;
    await acp.result('initialize', { protocolVersion: 1, clientCapabilities: {} });
    if (!(await this.openSession())) {
      return;
    }
    state.initDone = true;
    start.onSessionRef(state.sessionId!);
    await acp.result('session/set_mode', { sessionId: state.sessionId, modeId: start.permissionMode === 'bypass' ? 'yolo' : 'auto' });
    if (start.model !== null) {
      await acp.result('session/set_config_option', { sessionId: state.sessionId, configId: 'model', value: start.model });
    }
    if (start.compactFirst === true && start.resumeRef !== null) {
      await this.parts.turns.run('/compact');
    }
    await this.parts.turns.settle(await this.parts.turns.run(start.instruction));
  }

  /** `session/load` (resume) or `session/new`; false = the resume failed and was reported. */
  private async openSession(): Promise<boolean> {
    const { state, acp, start } = this.ctx;
    if (start.resumeRef === null) {
      state.sessionId = kimiText((await acp.result('session/new', { cwd: start.cwd, mcpServers: [] }))['sessionId']);
      return true;
    }
    state.replaying = true;
    try {
      await acp.result('session/load', { sessionId: start.resumeRef, cwd: start.cwd, mcpServers: [] });
    } catch (error) {
      state.replaying = false;
      start.onResumeFailed?.(error instanceof Error ? error.message : String(error));
      state.initDone = true;
      this.ctx.finish();
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS)); // the history replays as updates
    state.replaying = false;
    state.sessionId = start.resumeRef;
    await this.parts.turns.skipEarlierUsage(state.sessionId);
    return true;
  }
}
