import type { SteerRung } from '../protocol';
import type { RunnerProcess } from '../ports/process-spawner';
import { assistantEvents, rateLimitEvent, toolResultEvents, turnEnd } from './claude-code-events';
import type { NormalizedEvent, NowFn, ProviderStart, WorkerHandle } from './contract';
import { stderrLines } from './line-buffer';
import { StreamJsonCodec, type StreamJsonMessage } from './stream-json-codec';

/**
 * One Claude Code worker (ADR-0075): stdin held open, so a steer writes a
 * user message in; a finished turn closes the input (the process exits, the
 * run ends) unless the owner holds the run or the turn asked a question.
 * A resume that exits before its init event never established the session
 * (T-0049); compact-first sends `/compact` and waits for its result before
 * the instruction rides.
 */
export class ClaudeCodeWorker implements WorkerHandle {
  readonly exited: Promise<number | null>;
  private readonly codec = new StreamJsonCodec();
  private held = false;
  /** The last turn asked the owner something (req-64): stand until answered. */
  private questionHold = false;
  /** A prompt is out and its result has not come back. */
  private busy = true;
  private inputClosed = false;
  private initSeen = false;
  private compactPending: boolean;

  constructor(
    private readonly proc: RunnerProcess,
    private readonly start: ProviderStart,
    private readonly now: NowFn,
  ) {
    this.compactPending = start.compactFirst === true && start.resumeRef !== null;
    proc.onStdout((chunk) => this.read(chunk));
    proc.onStderr((chunk) => stderrLines(chunk).forEach((text) => this.emit({ kind: 'note', detail: 'stderr', text })));
    // Registered before `exited` so it fires first: the supervisor's fallback guard is set before the exit is read.
    proc.onExit((code) => {
      if (!this.initSeen && start.resumeRef !== null) {
        start.onResumeFailed?.(`the CLI exited (${code ?? 'signal'}) before its session was established`);
      }
    });
    this.exited = new Promise<number | null>((resolve) => proc.onExit(resolve));
    proc.write(this.codec.userMessage(this.compactPending ? '/compact' : start.instruction));
  }

  get pid(): number | null {
    return this.proc.pid;
  }

  async steer(text: string): Promise<SteerRung> {
    if (this.inputClosed) {
      return 'refused';
    }
    this.proc.write(this.codec.userMessage(text));
    // The owner's message answers an open question: the next finished turn ends the run again.
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
    if (held) {
      return;
    }
    // Released while standing: nothing more is coming, the run ends.
    if (this.questionHold) {
      this.questionHold = false;
      this.emit({ kind: 'usage', waiting: null });
    }
    if (!this.busy) {
      this.closeInput();
    }
  }

  async interrupt(): Promise<boolean> {
    if (this.inputClosed || !this.busy) {
      return false;
    }
    this.proc.write(this.codec.interrupt(`drey-${this.now().getTime()}`));
    return true;
  }

  async stop(): Promise<void> {
    this.closeInput();
    await this.proc.killTree();
  }

  private read(chunk: string): void {
    for (const line of this.codec.decode(chunk)) {
      if ('garbage' in line) {
        this.emit({ kind: 'note', detail: 'stderr', text: line.garbage.slice(0, 400) });
      } else {
        this.dispatch(line.message);
      }
    }
  }

  private dispatch(message: StreamJsonMessage): void {
    if (message.type === 'system' && message.subtype === 'init' && typeof message.session_id === 'string') {
      this.initSeen = true;
      this.start.onSessionRef(message.session_id);
      if (Array.isArray(message.slash_commands)) {
        this.emit({ kind: 'usage', commands: message.slash_commands.filter((c): c is string => typeof c === 'string').map((c) => c.replace(/^\//, '')) });
      }
    } else if (message.type === 'user' && message.message !== undefined) {
      toolResultEvents(message).forEach((e) => this.emit(e));
    } else if (message.type === 'assistant' && message.message !== undefined) {
      assistantEvents(message).forEach((e) => this.emit(e));
    } else if (message.type === 'rate_limit_event') {
      const event = rateLimitEvent(message);
      if (event !== null) {
        this.emit(event);
      }
    } else if (message.type === 'result') {
      this.onResult(message);
    }
  }

  private onResult(message: StreamJsonMessage): void {
    const end = turnEnd(message);
    this.busy = false;
    if (end.kind === 'question') {
      this.questionHold = true; // a question to the owner (req-64): the input stays open for the answer
    }
    end.events.forEach((e) => this.emit(e));
    if (end.kind === 'done' && this.compactPending) {
      // The compact's own result: the session is compacted, the real instruction follows now.
      this.compactPending = false;
      this.proc.write(this.codec.userMessage(this.start.instruction));
      this.busy = true;
      this.emit({ kind: 'usage', turn: 'busy' });
      return;
    }
    if (end.kind !== 'question' && !this.held) {
      this.closeInput();
    }
  }

  private closeInput(): void {
    if (!this.inputClosed) {
      this.inputClosed = true;
      this.proc.endInput();
    }
  }

  private emit(event: Omit<NormalizedEvent, 'ts'>): void {
    this.start.onEvent({ ts: this.now().toISOString(), ...event });
  }
}
