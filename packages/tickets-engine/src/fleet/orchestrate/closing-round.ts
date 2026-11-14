import { costOf } from '../../core/model-prices';
import type { JournalEntry, JournalGate } from '../../core/persona-journal';
import { closingRoundPrompt, parseClosingAnswer, type ClosingAnswer } from '../closing-round-prompt';
import type { Clock } from '../ports/clock';
import { isOneOnOne } from '../protocol-session';
import { shortGateLine } from '../run/run-summary';
import type { ClosingAssessment, ClosingSignalRule } from './closing-signal-rule';
import type { ClosingRoundRecords, RoundRecorded } from './closing-round-records';
import { messageOf, type LiveRun } from './live-run';
import type { ClosingRoundAsker, RoundReply, RoundUsage } from './resume-round-asker';

export interface ClosingRoundDeps {
  readonly rule: ClosingSignalRule;
  readonly asker: ClosingRoundAsker;
  /** Where the journal entry, the lesson and the proposal go: the engine's one commit, or plain writes (req-225). */
  readonly records: ClosingRoundRecords;
  readonly clock: Clock;
  /** The runner's own line in the run's transcript. */
  readonly note: (run: LiveRun, what: string) => Promise<void>;
  readonly log: (message: string) => void;
}

/** What one round found, as the journal entry is built from it. */
interface RoundOutcome {
  readonly run: LiveRun;
  readonly persona: string;
  readonly assessment: ClosingAssessment;
  readonly answer: ClosingAnswer | null;
  readonly reply: RoundReply;
}

function gateOf(result: 'green' | 'red' | null | undefined): JournalGate {
  return result === 'red' || result === 'green' ? result : 'none';
}

/** Why an entry carries no finding of the round's: the round did not run, or its answer did not parse. */
function noteOf(reply: RoundReply, answer: ClosingAnswer | null): string | null {
  if (reply.kind === 'skipped') {
    return `round skipped — ${reply.reason}`;
  }
  return answer === null ? 'the answer did not parse' : null;
}

/** The round's spend added to the run's record, so the settle and the ledgers count it. */
function withRoundUsage(run: LiveRun, usage: RoundUsage): void {
  const info = run.info;
  const roundCost = usage.costUsd ?? costOf(info.model ?? null, usage.tokensIn, usage.tokensOut) ?? 0;
  run.info = {
    ...info,
    tokensIn: info.tokensIn + usage.tokensIn,
    tokensOut: info.tokensOut + usage.tokensOut,
    costUsd: info.costUsd === null ? null : info.costUsd + roundCost,
  };
}

/**
 * A run's closing round (R14, req-169): after the gate verdict and before
 * the ticket goes back, a run that raised a signal (red gate, retry, owner
 * steer, cost outlier, reported friction) is asked once where it stumbled;
 * the finding goes to the persona's journal (`reviews.md`), at most one
 * lesson straight into `memory.md`, a prompt or model change only as an
 * open proposal — in Drey Service as one commit of the engine's (req-225).
 * A run whose worker saved its lesson through `memory_write` (req-226) gets
 * no second one here. A smooth run costs no round and writes nothing. A
 * round that cannot run still journals the runner's facts and says why.
 * Nothing here fails the run: every error is a log line.
 */
export class ClosingRound {
  constructor(private readonly deps: ClosingRoundDeps) {}

  async afterGate(run: LiveRun): Promise<void> {
    const persona = run.info.persona ?? null;
    if (persona === null || isOneOnOne(run.request) || run.request.interactive !== undefined) {
      return;
    }
    try {
      const assessment = this.deps.rule.assess(run);
      if (assessment.signals.length === 0) {
        return;
      }
      await this.round(run, persona, assessment);
    } catch (error) {
      this.deps.log(`run ${run.info.id}: closing round failed — ${messageOf(error)}`);
    }
  }

  private async round(run: LiveRun, persona: string, assessment: ClosingAssessment): Promise<void> {
    await this.deps.note(run, `closing round — ${assessment.signals.join(', ')}`);
    const reply = await this.deps.asker.ask(run, this.promptOf(run, assessment));
    const answer = reply.kind === 'answered' ? parseClosingAnswer(reply.text) : null;
    if (reply.kind === 'answered') {
      withRoundUsage(run, reply.usage);
    }
    const entry = this.entryOf({ run, persona, assessment, answer, reply });
    const lesson = run.lessonWritten === true ? null : (answer?.lesson ?? null);
    const recorded = await this.deps.records.write(run, { persona, entry, lesson, proposal: answer?.proposal ?? null });
    await this.deps.note(run, this.summaryOf(run, { reply, answer, recorded }));
  }

  private promptOf(run: LiveRun, assessment: ClosingAssessment): string {
    const failure = run.info.gateFailure ?? null;
    return closingRoundPrompt({
      ticketId: run.info.ticketId,
      gate: run.info.gateResult === 'red' ? 'red' : run.info.gateResult === 'green' ? 'green' : 'none',
      gateFailure: failure === null ? null : shortGateLine(failure),
      signals: assessment.signals,
      steerCount: run.info.steerCount,
      costUsd: assessment.costUsd,
      typicalCostUsd: assessment.typicalCostUsd,
      friction: run.friction ?? null,
      lessonWritten: run.lessonWritten === true,
    });
  }

  private entryOf(round: RoundOutcome): JournalEntry {
    const { run, persona, assessment, answer } = round;
    const info = run.info;
    return {
      at: this.deps.clock.now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ticket: /^T-\d{4,}$/.test(info.ticketId) ? info.ticketId : null,
      persona,
      harness: info.provider,
      model: info.model ?? run.request.model ?? null,
      gate: gateOf(info.gateResult),
      costUsd: assessment.costUsd,
      signals: assessment.signals,
      friction: run.friction ?? answer?.friction ?? null,
      finding: answer?.finding ?? null,
      note: noteOf(round.reply, answer),
    };
  }

  private summaryOf(run: LiveRun, round: { reply: RoundReply; answer: ClosingAnswer | null; recorded: RoundRecorded }): string {
    const { reply, answer, recorded } = round;
    const commit = recorded.committed ? ' (one commit)' : '';
    if (reply.kind === 'skipped') {
      return `closing round skipped — ${reply.reason}; the journal holds the run's facts${commit}`;
    }
    const lesson = recorded.lesson !== null ? 'one memory lesson' : run.lessonWritten === true ? 'the run saved its lesson itself' : 'no lesson';
    const parts = ['journal entry written', lesson, ...(recorded.proposal !== null ? [`proposal ${recorded.proposal} for the 1:1`] : [])];
    return `closing round done — ${answer === null ? 'the answer did not parse; ' : ''}${parts.join(', ')}${commit}`;
  }
}
