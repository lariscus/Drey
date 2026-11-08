import type { PermissionDecision, QuestionAnswers, SteerRung } from '../protocol';
import { answersText } from '../providers';
import type { StopOutcome, TakeoverOutcome } from '../run/run-record';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';

const DECISION_WORDS: Readonly<Record<PermissionDecision, string>> = { reject: 'rejected', always: 'approved always', once: 'approved once' };

/**
 * The owner's answers to what a worker waits for (req-64): an approval or a
 * question form. Neither is a takeover — the worker goes on with its step.
 * A claim given up for the wait (Q-03) is taken again first: the worker
 * never goes on writing for a ticket that is not ours.
 */
export class OwnerAnswers {
  constructor(
    private readonly repo: RunRepository,
    private readonly bookkeeper: RunBookkeeper,
    private readonly streams: RunStreams,
  ) {}

  async answerPermission(runId: string, decision: PermissionDecision): Promise<TakeoverOutcome> {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    const waiting = run.info.waiting ?? null;
    if (waiting === null || waiting.kind !== 'permission' || waiting.requestId === undefined) {
      return { ok: false, error: `run ${runId} waits for no approval` };
    }
    if (run.handle === null || run.handle.answerPermission === undefined) {
      return { ok: false, error: `the ${run.info.provider} worker takes no approvals` };
    }
    const reclaimed = await this.bookkeeper.reclaimAfterWait(run, `${decision}: ${waiting.text}`);
    if (!reclaimed.ok) {
      return reclaimed;
    }
    if (!(await run.handle.answerPermission(waiting.requestId, decision))) {
      return { ok: false, error: 'the worker took no answer — the request may be gone' };
    }
    await this.bookkeeper.note(run, `${DECISION_WORDS[decision]} by the owner — ${waiting.text.slice(0, 200)}`);
    return { ok: true };
  }

  /** OpenCode's `question` tool: per question a choice or the owner's own words. */
  async answerQuestion(runId: string, answers: QuestionAnswers): Promise<StopOutcome & { rung?: SteerRung }> {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    const waiting = run.info.waiting ?? null;
    if (waiting === null || waiting.questions === undefined || waiting.requestId === undefined) {
      return { ok: false, error: `run ${runId} asks no question` };
    }
    if (run.handle === null || run.handle.answerQuestion === undefined) {
      return { ok: false, error: `the ${run.info.provider} worker takes no answers` };
    }
    const said = answersText(waiting.questions, answers);
    if (Object.keys(answers).length === 0) {
      return { ok: false, error: 'the answer is empty' };
    }
    const reclaimed = await this.bookkeeper.reclaimAfterWait(run, said);
    if (!reclaimed.ok) {
      return reclaimed;
    }
    if (!(await run.handle.answerQuestion(waiting.requestId, answers))) {
      return { ok: false, error: 'the worker took no answer — the question may be gone' };
    }
    await this.streams.say(run, `you › ${said}`);
    await this.bookkeeper.note(run, `answered by the owner: ${said.slice(0, 200)}`);
    return { ok: true, rung: 'inject' };
  }
}
