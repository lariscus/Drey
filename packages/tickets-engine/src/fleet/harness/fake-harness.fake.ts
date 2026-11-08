import type { PermissionDecision, QuestionAnswers, SteerRung } from '../protocol';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { blockedOf, questionOf } from './event-text';

/**
 * The fake harness (ADR-0096): an in-memory worker that keeps the adapter
 * contract — a finished turn ends the worker unless the owner holds it or
 * it asked a question; a steer answers or starts a turn; interrupt stops a
 * running turn only; stop ends it. It runs through the same contract suite
 * as the real adapters (`contract.spec.ts`), so a spec built on it tests
 * against the contract, not against a script.
 */
export class FakeHarnessWorker implements WorkerHandle {
  readonly pid = 4242;
  readonly exited: Promise<number | null>;
  readonly steered: string[] = [];
  private resolveExit: ((code: number | null) => void) | null = null;
  private busy = true;
  private held = false;
  private questionHold = false;
  private ended = false;

  constructor(private readonly start: ProviderStart) {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.emit({ kind: 'usage', turn: 'busy' });
  }

  /** The worker ends its running turn with this final message. */
  finishTurn(text: string): void {
    if (this.ended || !this.busy) {
      return;
    }
    this.busy = false;
    const question = questionOf(text);
    if (question !== null) {
      this.questionHold = true;
      this.emit({ kind: 'usage', turn: 'idle', waiting: { kind: 'question', text: question } });
      return;
    }
    this.emit({ kind: 'result', text, blocked: blockedOf(text), tokensIn: 0, tokensOut: 0 });
    this.emit({ kind: 'usage', turn: 'idle' });
    if (!this.held) {
      this.end(0);
    }
  }

  async steer(text: string): Promise<SteerRung> {
    if (this.ended) {
      return 'refused';
    }
    this.steered.push(text);
    const answered = this.questionHold;
    this.questionHold = false;
    if (!this.busy || answered) {
      this.busy = true;
      this.emit({ kind: 'usage', turn: 'busy', ...(answered ? { waiting: null } : {}) });
    }
    return 'inject';
  }

  setHold(held: boolean): void {
    this.held = held;
    if (!held && !this.busy) {
      if (this.questionHold) {
        this.questionHold = false;
        this.emit({ kind: 'usage', waiting: null });
      }
      this.end(0);
    }
  }

  async interrupt(): Promise<boolean> {
    if (this.ended || !this.busy) {
      return false;
    }
    this.busy = false;
    this.emit({ kind: 'usage', turn: 'idle' });
    return true;
  }

  async answerPermission(_requestId: string, _decision: PermissionDecision): Promise<boolean> {
    return !this.ended;
  }

  async answerQuestion(_formId: string, _answers: QuestionAnswers): Promise<boolean> {
    return !this.ended;
  }

  async stop(): Promise<void> {
    this.end(null);
  }

  private end(code: number | null): void {
    if (!this.ended) {
      this.ended = true;
      this.resolveExit?.(code);
    }
  }

  private emit(event: Omit<NormalizedEvent, 'ts'>): void {
    this.start.onEvent({ ts: '2026-11-08T12:00:00Z', ...event });
  }
}

export class FakeHarnessAdapter implements ProviderAdapter {
  readonly id = 'opencode' as const;
  readonly label = 'Fake harness';
  readonly liveInject = true;
  readonly workers: FakeHarnessWorker[] = [];

  spawn(start: ProviderStart): WorkerHandle {
    const worker = new FakeHarnessWorker(start);
    this.workers.push(worker);
    return worker;
  }
}
