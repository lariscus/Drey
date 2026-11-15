import type { ClosingRoundWrite, ClosingRoundWritten } from '../../contracts/persona-run-records';
import { personaLessonLine } from '../../core/persona/memory-line';
import { renderJournalEntry } from '../../core/persona/persona-journal';
import type { Clock } from '../ports/clock';
import type { ClosingRoundRecords, RoundRecord, RoundRecorded } from './closing-round-records';
import { messageOf, type LiveRun } from './live-run';

/**
 * The engine's writer of the run's persona records, as the runner reaches it
 * (req-225): Drey Service's invoke channel. Null back = the engine is not up.
 */
export interface PersonaRecordsChannel {
  closingRound(write: ClosingRoundWrite): Promise<ClosingRoundWritten | null>;
}

export interface EngineRoundRecordsDeps {
  readonly channel: PersonaRecordsChannel;
  /** The plain writes, when no engine owns the run's vault (not up, or another vault). */
  readonly fallback: ClosingRoundRecords;
  readonly clock: Clock;
  readonly log: (message: string) => void;
}

const NOTHING: RoundRecorded = { lesson: null, proposal: null, committed: false };

/**
 * A closing round's records handed to the engine (req-225): its one writer
 * of the tickets repository writes the journal entry, the lesson and the
 * proposal and makes them one commit `personas: <id> closing round
 * <ticket>`, on the same git queue as every board commit — no second writer
 * racing it for `index.lock` (D-65). A run whose vault the engine does not
 * hold, or a round while the engine is down, writes plainly instead.
 */
export class EngineRoundRecords implements ClosingRoundRecords {
  constructor(private readonly deps: EngineRoundRecordsDeps) {}

  async write(run: LiveRun, record: RoundRecord): Promise<RoundRecorded> {
    let reply: ClosingRoundWritten | null;
    try {
      reply = await this.deps.channel.closingRound(this.writeOf(run, record));
    } catch (error) {
      this.deps.log(`run ${run.info.id}: the engine did not take the closing round — ${messageOf(error)}`);
      reply = null;
    }
    if (reply === null || (!reply.ok && reply.foreign === true)) {
      return this.deps.fallback.write(run, record);
    }
    if (!reply.ok) {
      this.deps.log(`run ${run.info.id}: closing round records failed — ${reply.error}`);
      return NOTHING;
    }
    if (reply.warning !== undefined) {
      this.deps.log(`run ${run.info.id}: closing round records not committed — ${reply.warning}`);
    }
    return { lesson: reply.lesson, proposal: reply.proposal, committed: reply.warning === undefined };
  }

  private writeOf(run: LiveRun, record: RoundRecord): ClosingRoundWrite {
    const { info } = run;
    const ticket = /^T-\d{4,}$/.test(info.ticketId) ? info.ticketId : null;
    const lesson =
      record.lesson === null || record.lesson.trim() === ''
        ? null
        : personaLessonLine({ date: this.deps.clock.now().toISOString().slice(0, 10), ticket, persona: record.persona, model: info.model ?? run.request.model ?? 'unknown', lesson: record.lesson });
    const proposal = record.proposal === null ? null : { ...record.proposal, evidence: renderJournalEntry(record.entry)[0]!.slice(2) };
    return { vaultPath: run.request.ticketsVaultPath, persona: record.persona, ticket, runStartedAt: info.startedAt, journal: record.entry, lesson, proposal };
  }
}
