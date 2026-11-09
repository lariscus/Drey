import { costOf } from '../../core/model-prices';
import { parseShapedQuestion } from '../../contracts/question-shape';
import { AcpCost } from './acp-cost';
import type { AcpUsageMeter } from './acp-harness';
import { acpEmit, acpText, type AcpContext } from './acp-state';
import type { AcpUpdateFold } from './acp-update-fold';
import type { NormalizedEvent } from './contract';
import { blockedOf, questionOf } from './event-text';

export type TurnOutcome = 'end_turn' | 'cancelled' | 'error';

type Totals = Pick<NormalizedEvent, 'tokensIn' | 'tokensOut' | 'cacheReadTokens' | 'costUsd'>;

/**
 * An ACP worker's prompt turns (E10-8, req-182): one `session/prompt` to its
 * stop reason, the usage the harness's meter reads after it (the reply's
 * `usage`, or Kimi's wire log), the cost (the harness's report, else the
 * price table), and what the turn's end means — a question stands, an
 * owner's follow-up rides next, a result ends the run unless the owner
 * holds it; a cancel made room for a steer message.
 */
export class AcpTurns {
  private totalIn = 0;
  private totalOut = 0;
  private totalCacheRead = 0;
  /** The model calls the last turn added (0 = the harness reported none). */
  private turnRecords = 0;
  private readonly cost: AcpCost;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: AcpContext,
    private readonly fold: AcpUpdateFold,
    private readonly meter: AcpUsageMeter,
  ) {
    this.emit = acpEmit(ctx);
    this.cost = new AcpCost(ctx.start.resumeRef !== null);
  }

  /** What the resumed session spent before this run is not this run's. */
  async skipEarlierUsage(sessionId: string): Promise<void> {
    await this.meter.skipEarlier(sessionId);
  }

  /** One prompt turn to its end; resolves with how it stopped. */
  async run(prompt: string): Promise<TurnOutcome> {
    const state = this.ctx.state;
    state.busy = true;
    this.fold.resetTurn();
    this.emit({ kind: 'usage', turn: 'busy' });
    let reply: Record<string, unknown>;
    try {
      reply = await this.ctx.acp.result('session/prompt', { sessionId: state.sessionId, prompt: [{ type: 'text', text: prompt }] });
    } catch (error) {
      await this.turnOver({});
      this.emit({ kind: 'usage', ...this.totals() });
      this.emit({ kind: 'error', text: `prompt failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` });
      this.emit({ kind: 'usage', turn: 'idle' });
      return 'error';
    }
    await this.turnOver(reply);
    const stop = acpText(reply['stopReason']);
    if (stop === 'cancelled') {
      this.emit({ kind: 'usage', ...this.totals(), turn: 'idle' });
      return 'cancelled';
    }
    const refused = this.refusalOf(stop);
    if (refused !== null) {
      this.emit({ kind: 'usage', ...this.totals() });
      this.emit({ kind: 'error', text: refused });
      this.emit({ kind: 'usage', turn: 'idle' });
      return 'error';
    }
    return 'end_turn';
  }

  /**
   * A turn the provider refused is no finished step (T-0061): ACP's
   * `refusal`, or a turn that ended with no message, no tool call and no
   * tokens — no agent-done, no gate on untouched code.
   */
  private refusalOf(stop: string): string | null {
    if (stop === 'refusal') {
      return 'the provider refused the turn';
    }
    if (stop === 'end_turn' && this.ctx.harness.emptyTurnIsRefusal && this.fold.answer === '' && this.fold.toolCalls === 0 && this.turnRecords === 0) {
      return 'the provider answered the prompt with nothing — no model message, no tokens';
    }
    return null;
  }

  async settle(outcome: TurnOutcome): Promise<void> {
    const state = this.ctx.state;
    if (outcome === 'error') {
      return state.held ? undefined : this.ctx.finish();
    }
    if (outcome === 'cancelled') {
      // An owner's interrupt stands the session for the owner; a cancel for a steer (or a declined form's text) runs the message next.
      const next = state.steerAfterCancel ?? state.followUp;
      state.steerAfterCancel = null;
      state.followUp = null;
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

  private async turnOver(reply: Readonly<Record<string, unknown>>): Promise<void> {
    this.ctx.state.busy = false;
    this.fold.flushThought();
    await this.readUsageEvents(reply);
  }

  /** The model calls the turn added: events for the run, totals for the result. */
  private async readUsageEvents(reply: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.ctx.state;
    if (state.sessionId === null) {
      return;
    }
    const records = await this.meter.turnRecords(state.sessionId, reply).catch(() => []);
    this.turnRecords = records.length;
    let turnIn = 0;
    let turnOut = 0;
    for (const record of records) {
      state.model = record.model ?? state.model;
      const inputSide = record.inputOther + record.cacheRead + record.cacheCreation;
      turnIn += inputSide;
      turnOut += record.output;
      this.totalCacheRead += record.cacheRead;
      // A per-call record is the context the call saw; a turn's sum is not — the agent's `usage_update` says that.
      this.emit({ kind: 'usage', ...(record.aggregate === true ? {} : { contextTokens: inputSide }), turnUsage: { input: record.inputOther, cacheRead: record.cacheRead, cacheCreation: record.cacheCreation, output: record.output } });
    }
    this.totalIn += turnIn;
    this.totalOut += turnOut;
    this.cost.settle(state.reportedCost, costOf(state.model, turnIn, turnOut));
  }

  private totals(): Totals {
    const cost = this.cost.total(costOf(this.ctx.state.model, this.totalIn, this.totalOut));
    return { tokensIn: this.totalIn, tokensOut: this.totalOut, cacheReadTokens: this.totalCacheRead, ...(cost !== null ? { costUsd: cost } : {}) };
  }
}
