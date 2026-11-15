import { renderJournalEntry } from '../../core/persona/persona-journal';
import type { ClosingRoundRecords, RoundRecord, RoundRecorded } from './closing-round-records';
import type { LiveRun } from './live-run';
import type { PersonaJournalWriter } from './persona-journal-writer';
import type { PersonaMemory } from './persona-memory';
import type { RoundProposalWriter } from './round-proposal-writer';

export interface DiskRoundRecordsDeps {
  readonly journal: PersonaJournalWriter;
  readonly memory: PersonaMemory;
  readonly proposals: RoundProposalWriter;
}

/**
 * A closing round's records as plain writes into the tickets repository
 * (req-169): the standalone runner's way, and the fallback when no engine
 * owns the run's vault. Nothing is committed — the owner commits.
 */
export class DiskRoundRecords implements ClosingRoundRecords {
  constructor(private readonly deps: DiskRoundRecordsDeps) {}

  async write(run: LiveRun, record: RoundRecord): Promise<RoundRecorded> {
    const vault = run.request.ticketsVaultPath;
    await this.deps.journal.append(vault, record.entry, run.info.startedAt);
    const lesson = record.lesson === null ? null : await this.deps.memory.appendLesson(run, record.lesson);
    const proposal = record.proposal === null ? null : await this.deps.proposals.add(vault, record.persona, record.proposal, renderJournalEntry(record.entry)[0]!.slice(2));
    return { lesson, proposal, committed: false };
  }
}
