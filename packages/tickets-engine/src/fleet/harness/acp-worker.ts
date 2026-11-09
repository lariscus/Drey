import type { PermissionDecision, QuestionAnswers, SteerRung } from '../protocol';
import type { RunnerProcess } from '../ports/process-spawner';
import type { NormalizedEvent, WorkerHandle } from './contract';
import type { AcpRequests } from './acp-requests';
import type { AcpSessionOpener } from './acp-session-open';
import { acpEmit, type AcpContext } from './acp-state';
import type { AcpTurns } from './acp-turns';

/**
 * One ACP worker's handle (E10-8, req-182 — Kimi, Copilot CLI, opencode):
 * the session opened (`AcpSessionOpener`), the mode the harness picks for
 * the permission mode, the model pin, compact-first, then the brief as the
 * first turn. A steer while a turn
 * runs cancels it (`session/cancel`) and rides next; the owner's interrupt
 * is the same cancel — the session stays for the owner (ADR-0096).
 */
export class AcpWorker implements WorkerHandle {
  readonly exited: Promise<number | null>;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: AcpContext,
    private readonly proc: RunnerProcess,
    private readonly parts: { readonly turns: AcpTurns; readonly requests: AcpRequests; readonly opener: AcpSessionOpener },
  ) {
    this.emit = acpEmit(ctx);
    // Registered before `exited`: a resume that never got a session is reported first.
    proc.onExit((code) => {
      if (!ctx.state.initDone && ctx.start.resumeRef !== null) {
        ctx.start.onResumeFailed?.(`${ctx.harness.agent} exited (${code ?? 'signal'}) before the session was established`);
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
      this.emit({ kind: 'error', text: `${this.ctx.harness.agent}: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` });
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
    const { state, acp, start, harness } = this.ctx;
    const offer = await this.parts.opener.open();
    if (offer === null) {
      return;
    }
    state.initDone = true;
    state.model = start.model ?? offer.model;
    start.onSessionRef(state.sessionId!);
    const mode = harness.modeFor(start.permissionMode, offer.modes);
    if (mode.note !== null) {
      this.emit({ kind: 'note', text: mode.note });
    }
    if (mode.modeId !== null) {
      await acp.result('session/set_mode', { sessionId: state.sessionId, modeId: mode.modeId });
    }
    if (start.model !== null && harness.model === 'config') {
      await acp.result('session/set_config_option', { sessionId: state.sessionId, configId: 'model', value: start.model });
    }
    if (start.compactFirst === true && start.resumeRef !== null) {
      await this.parts.turns.run('/compact');
    }
    await this.parts.turns.settle(await this.parts.turns.run(start.instruction));
  }
}
