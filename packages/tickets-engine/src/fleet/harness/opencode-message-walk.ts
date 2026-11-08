import { parseShapedQuestion } from '../../contracts/question-shape';
import type { NormalizedEvent } from './contract';
import { activityLine, questionOf, THINK_MAX, THINK_PREFIX, toolActivity } from './event-text';
import { messageText, providerErrorText, type OcMessage } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';

/** The message has settled (the list shows a message while it still streams). */
function completed(m: OcMessage): boolean {
  return (m.time?.completed ?? 0) > 0;
}

/**
 * One poll's read of an OpenCode message list (newest first, walked
 * chronologically): the turn state, each completed assistant message once
 * (thinking, text — unless the subscription sealed the same text — tool
 * calls, its per-call usage), and the turn's end as the server writes it
 * (the `idle` marker): a refusal, a question that stands, or done.
 */
export class OpencodeMessageWalk {
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly sealed: ReadonlyMap<string, readonly string[]>,
  ) {
    this.emit = emitOf(ctx);
  }

  walk(list: readonly OcMessage[]): void {
    this.turnState(list[0]);
    // Whether a model message follows the newest prompt (req-80) — read from the order, never the server's clock.
    let answered = true;
    for (const m of list.slice().reverse()) {
      if (m.type === 'user') {
        answered = false;
      } else if (m.type === 'assistant') {
        answered = true;
        this.markHistory(m);
        this.assistant(m);
      } else if (m.type === 'idle' && (m.time?.created ?? 0) >= this.ctx.state.lastPromptAt) {
        this.idle(m, answered);
      }
    }
  }

  /** The newest message says whether the worker stands (an idle marker) or is mid-turn. */
  private turnState(newest: OcMessage | undefined): void {
    if (newest === undefined) {
      return;
    }
    const turn = newest.type === 'idle' ? 'idle' : 'busy';
    if (turn !== this.ctx.state.turn) {
      this.ctx.state.turn = turn;
      this.emit({ kind: 'usage', turn });
    }
  }

  /** A message settled before the run (attach, resume) is history: never re-emitted. */
  private markHistory(m: OcMessage): void {
    const { state } = this.ctx;
    const settledAt = m.time?.completed ?? m.time?.created ?? 0;
    if (state.seenBeforeMs === null || m.id === undefined || settledAt <= 0 || settledAt > state.seenBeforeMs) {
      return;
    }
    state.seenAssistant.add(m.id);
    (m.content ?? []).filter((part) => part.type === 'tool' && part.id !== undefined).forEach((part) => state.seenTools.add(part.id!));
  }

  private assistant(m: OcMessage): void {
    const { state } = this.ctx;
    if (m.tokens !== undefined) {
      state.contextTokens = (m.tokens.input ?? 0) + (m.tokens.cache?.read ?? 0);
    }
    // Read once COMPLETE: the list shows a message while it streams, and reading it early lost most of it.
    const fresh = completed(m) && m.id !== undefined && !state.seenAssistant.has(m.id);
    if (fresh) {
      state.seenAssistant.add(m.id!);
      this.words(m);
    }
    this.tools(m);
    // The message's own per-call usage, once, AFTER its tool calls — a 2 s poll must not inflate the sums.
    if (fresh) {
      this.callUsage(m);
    }
    if (completed(m)) {
      state.lastText = messageText(m) || state.lastText;
    }
  }

  private callUsage(m: OcMessage): void {
    const t = m.tokens;
    if (t !== undefined) {
      this.emit({ kind: 'usage', turnUsage: { input: t.input ?? null, cacheRead: t.cache?.read ?? null, cacheCreation: t.cache?.write ?? null, output: t.output ?? null } });
    }
  }

  /** The message's thinking and text; text the subscription already sealed whole is not shown twice. */
  private words(m: OcMessage): void {
    const thought = (m.content ?? []).filter((part) => part.type === 'reasoning').map((part) => part.text ?? '').join('\n\n').trim();
    if (thought !== '') {
      this.emit({ kind: 'note', text: `${THINK_PREFIX}${thought.slice(0, THINK_MAX)}` });
    }
    const text = messageText(m);
    if (text === '') {
      return;
    }
    this.ctx.state.lastText = text;
    if (this.sealed.get(m.id!)?.join('\n') !== text) {
      this.emit({ kind: 'text', text: text.slice(0, 8_000), activity: activityLine(text), ...this.context() });
    }
  }

  /** Every tool call is one visible step, shown once its input is there (a call is listed first with none). */
  private tools(m: OcMessage): void {
    for (const part of m.content ?? []) {
      const input = part.state?.input;
      if (part.type !== 'tool' || part.id === undefined || input === undefined || Object.keys(input).length === 0 || this.ctx.state.seenTools.has(part.id)) {
        continue;
      }
      this.ctx.state.seenTools.add(part.id);
      const activity = toolActivity(part.name, input);
      this.emit({ kind: 'note', text: activity, activity, ...(part.name !== undefined ? { tool: part.name } : {}), ...this.context() });
    }
  }

  private context(): { contextTokens?: number } {
    return this.ctx.state.contextTokens > 0 ? { contextTokens: this.ctx.state.contextTokens } : {};
  }

  /** The server wrote the turn's end into the list. */
  private idle(m: OcMessage, answered: boolean): void {
    const { state } = this.ctx;
    if (m.outcome === 'failed') {
      // The provider refused the turn (quota, rate limit, auth): no agent-done, no gate on untouched code.
      return this.refused(providerErrorText(m.error));
    }
    if (!answered && !state.held) {
      // A turn without one model message is a refusal the server did not mark failed (T-0061).
      return this.refused(m.error !== undefined ? providerErrorText(m.error) : 'the provider answered the prompt with nothing — no model message, no tokens');
    }
    // A turn that ends asking the owner (req-64) stands — reported once, held or not.
    const question = questionOf(state.lastText);
    if (question !== null && state.questionReportedFor !== state.lastPromptAt) {
      state.questionReportedFor = state.lastPromptAt;
      state.questionHold = true;
      const shaped = parseShapedQuestion(question);
      this.emit({ kind: 'usage', waiting: { kind: 'question', text: question, ...(shaped !== null ? { shaped } : {}) } });
    }
    if (!state.held && !state.questionHold) {
      state.turnDone = true;
    }
  }

  private refused(text: string): void {
    if (!this.ctx.state.ended) {
      this.ctx.state.ended = true;
      this.emit({ kind: 'error', text });
      void this.ctx.kill();
    }
  }
}
