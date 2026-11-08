import { costOf } from '../../core/model-prices';
import { parseShapedQuestion } from '../../contracts/question-shape';
import type { NormalizedEvent } from './contract';
import { blockedOf, questionOf } from './event-text';
import type { KimiUsageReader, KimiUsageRecord } from './kimi-usage';
import { kimiEmit, kimiText, type KimiContext } from './kimi-state';
import type { KimiUpdateFold } from './kimi-update-fold';

export type TurnOutcome = 'end_turn' | 'cancelled' | 'error';

type Totals = Pick<NormalizedEvent, 'tokensIn' | 'tokensOut' | 'cacheReadTokens' | 'costUsd'>;

/**
 * Kimi's prompt turns (E10-8): one `session/prompt` to its stop reason, the
 * usage read from the session's wire log after it (ACP reports no tokens;
 * the cost comes from the price table), and what the turn's end means — a
 * question stands, an owner's follow-up rides next, a result ends the run
 * unless the owner holds it; a cancel made room for a steer message.
 */
export class KimiTurns {
  private usageSeen = 0;
  private totalIn = 0;
  private totalOut = 0;
  private totalCacheRead = 0;
  private totalCost: number | null = null;
  private model: string | null;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: KimiContext,
    private readonly fold: KimiUpdateFold,
    private readonly readUsage: KimiUsageReader,
  ) {
    this.emit = kimiEmit(ctx);
    this.model = ctx.start.model;
  }

  /** What the resumed session spent before this run is not this run's. */
  async skipEarlierUsage(sessionId: string): Promise<void> {
    this.usageSeen = (await this.readUsage(sessionId).catch(() => [] as readonly KimiUsageRecord[])).length;
  }

  /** One prompt turn to its end; resolves with how it stopped. */
  async run(prompt: string): Promise<TurnOutcome> {
    const state = this.ctx.state;
    state.busy = true;
    this.fold.resetTurn();
    this.emit({ kind: 'usage', turn: 'busy' });
    let stop: string;
    try {
      stop = kimiText((await this.ctx.acp.result('session/prompt', { sessionId: state.sessionId, prompt: [{ type: 'text', text: prompt }] }))['stopReason']);
    } catch (error) {
      await this.turnOver();
      this.emit({ kind: 'usage', ...this.totals() });
      this.emit({ kind: 'error', text: `prompt failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` });
      this.emit({ kind: 'usage', turn: 'idle' });
      return 'error';
    }
    await this.turnOver();
    if (stop === 'cancelled') {
      this.emit({ kind: 'usage', ...this.totals(), turn: 'idle' });
      return 'cancelled';
    }
    return 'end_turn';
  }

  async settle(outcome: TurnOutcome): Promise<void> {
    const state = this.ctx.state;
    if (outcome === 'error') {
      return state.held ? undefined : this.ctx.finish();
    }
    if (outcome === 'cancelled') {
      // An owner's interrupt stands the session for the owner; a cancel for a steer runs the message next.
      const next = state.steerAfterCancel;
      state.steerAfterCancel = null;
      return next === null ? undefined : this.settle(await this.run(next));
    }
    return this.settleTurn();
  }

  /** After a turn that ended normally: a follow-up rides, a question stands, a result ends the run. */
  private async settleTurn(): Promise<void> {
    const state = this.ctx.state;
    const answer = this.fold.answer;
    if (answer !== '') {
      this.emit({ kind: 'text', text: answer.slice(0, 8_000) });
    }
    if (state.followUp !== null) {
      const next = state.followUp;
      state.followUp = null;
      return this.settle(await this.run(next));
    }
    const question = questionOf(answer);
    if (question !== null) {
      state.questionHold = true;
      const shaped = parseShapedQuestion(question);
      this.emit({ kind: 'usage', ...this.totals() });
      this.emit({ kind: 'usage', turn: 'idle', waiting: { kind: 'question', text: question, ...(shaped !== null ? { shaped } : {}) } });
      return;
    }
    this.emit({ kind: 'result', text: answer.slice(0, 8_000), blocked: blockedOf(answer), ...this.totals() });
    this.emit({ kind: 'usage', turn: 'idle' });
    if (!state.held) {
      this.ctx.finish();
    }
  }

  private async turnOver(): Promise<void> {
    this.ctx.state.busy = false;
    this.fold.flushThought();
    await this.readUsageEvents();
  }

  /** New model calls since the last read: events for the run, totals for the result. */
  private async readUsageEvents(): Promise<void> {
    const sessionId = this.ctx.state.sessionId;
    if (sessionId === null) {
      return;
    }
    const records = await this.readUsage(sessionId).catch(() => [] as readonly KimiUsageRecord[]);
    for (const record of records.slice(this.usageSeen)) {
      this.model = record.model ?? this.model;
      const inputSide = record.inputOther + record.cacheRead + record.cacheCreation;
      this.totalIn += inputSide;
      this.totalOut += record.output;
      this.totalCacheRead += record.cacheRead;
      this.emit({ kind: 'usage', contextTokens: inputSide, turnUsage: { input: record.inputOther, cacheRead: record.cacheRead, cacheCreation: record.cacheCreation, output: record.output } });
    }
    this.usageSeen = Math.max(this.usageSeen, records.length);
    this.totalCost = costOf(this.model, this.totalIn, this.totalOut);
  }

  private totals(): Totals {
    return { tokensIn: this.totalIn, tokensOut: this.totalOut, cacheReadTokens: this.totalCacheRead, ...(this.totalCost !== null ? { costUsd: this.totalCost } : {}) };
  }
}
